import * as cdk from 'aws-cdk-lib';
import {
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_logs as logs,
  aws_s3 as s3,
  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as tasks,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const targetLogGroupName = '<Please specify an exporting LogGroup>';
    const destinationPrefix = 'exported-logs';
    const temporaryDestinationPrefix = 'temp';
    const resultWriterPrefix = 'result-write-logs-for-moving-files';

    const {
      accountId,
      region
    } = new cdk.ScopedAws(this);

    // -----------------------------
    // LogGroup for Export target
    // -----------------------------
    const targetLogGroup = logs.LogGroup.fromLogGroupName(this, 'TargetLogGroup', targetLogGroupName);

    // -----------------------------
    // S3 Bucket for destination
    // -----------------------------
    const destinationBucket = new s3.Bucket(this, 'DestinationBucket', {
    });

    const bucketPolicy = new s3.BucketPolicy(this, 'DestinationBucketPolicy', {
      bucket: destinationBucket,
    });
    bucketPolicy.document.addStatements(new iam.PolicyStatement({
      principals: [
        new iam.ServicePrincipal('logs.amazonaws.com'),
      ],
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetBucketAcl',
      ],
      resources: [
        `${destinationBucket.bucketArn}`
      ],
      conditions: {
        'StringEquals': {
          'aws:SourceAccount': [ accountId ]
        },
        'ArnLike': {
          'aws:SourceArn': [ `${targetLogGroup.logGroupArn}` ]
        }
      }
    }));
    bucketPolicy.document.addStatements(new iam.PolicyStatement({
      principals: [
        new iam.ServicePrincipal('logs.amazonaws.com'),
      ],
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject',
      ],
      resources: [
        `${destinationBucket.bucketArn}/*`
      ],
      conditions: {
        'StringEquals': {
          's3:x-amz-acl': 'bucket-owner-full-control',
          'aws:SourceAccount': [ accountId ]
        },
        'ArnLike': {
          'aws:SourceArn': [ `${targetLogGroup.logGroupArn}` ]
        }
      }
    }));

    // -----------------------------
    // Step Functions state machine
    // -----------------------------

    const taskPrepare = new sfn.Pass(this, 'Prepare', {
      assign: {
        "target": `{%(
          $yesterday := ($toMillis($now()) - 24*60*60*1000);
          $from := $fromMillis($yesterday, '[Y0001]-[M01]-[D01]T00:00:00.000Z');
          $to := $fromMillis($yesterday, '[Y0001]-[M01]-[D01]T23:59:59.999Z');
          $datePrefix := $fromMillis($yesterday, '[Y0001]/[M01]/[D01]');

          {
            "from": $toMillis($from),
            "to": $toMillis($to),
            "datePrefix": $datePrefix
          }
      )%}`
      },
    });

    const taskExport = new tasks.CallAwsService(this, 'CreateExportTask', {
      service: 'cloudwatchlogs',
      action: 'createExportTask',
      iamResources: [
        targetLogGroup.logGroupArn,
      ],
      parameters: {
        "LogGroupName": targetLogGroup.logGroupName,
        "Destination": destinationBucket.bucketName,
        "DestinationPrefix": temporaryDestinationPrefix,
        "From": "{% $target.from %}",
        "To": "{% $target.to %}",
      },
      assign: {
        "exportTaskId": "{% $states.result.TaskId %}",
      }
    });

    const taskWait = new sfn.Wait(this, 'WaitExportTask', {
      time: sfn.WaitTime.duration(cdk.Duration.minutes(1)),
    });

    const taskDescribe = new tasks.CallAwsService(this, 'DescribeExportTasks', {
      service: 'cloudwatchlogs',
      action: 'describeExportTasks',
      iamResources: [
        '*',
      ],
      parameters: {
        "TaskId": "{% $exportTaskId %}",
      },
      assign: {
        'exportTaskStatusCode': '{% $states.result.ExportTasks[0].Status.Code %}',
      }
    });

    const taskMoveLogFiles = new sfn.CustomState(scope, 'MoveLogFiles', {
      stateJson: {
        "Type": "Map",
        "Label": "MoveLogFiles",
        "ItemReader": {
          "Resource": "arn:aws:states:::s3:listObjectsV2",
          "Arguments": {
            "Bucket": destinationBucket.bucketName,
            "Prefix": `{% "${temporaryDestinationPrefix}/" & $exportTaskId %}`
          }
        },
        "ItemSelector": {
          "exportTaskId": "{% $exportTaskId %}",
          "destinationBucket": destinationBucket.bucketName,
          "datePrefix": "{% $target.datePrefix %}",
          "targetObject": "{% $states.context.Map.Item.Value %}"
        },
        "ItemProcessor": {
          "ProcessorConfig": {
            "Mode": "DISTRIBUTED",
            "ExecutionType": "STANDARD"
          },
          "StartAt": "CopyObject",
          "States": {
            "CopyObject": {
              "Type": "Task",
              "Resource": "arn:aws:states:::aws-sdk:s3:copyObject",
              "Arguments": {
                "Bucket": destinationBucket.bucketName,
                "CopySource": `{% '${destinationBucket.bucketName}/' & $states.input.targetObject.Key %}`,
                "Key": `{%(
                  $temp := $replace($states.input.targetObject.Key, '${temporaryDestinationPrefix}/' & $states.input.exportTaskId & '/', '');
                  $newFileName := $replace($temp, '/', '-');
                  '${destinationPrefix}/' & $states.input.datePrefix & '/' & $newFileName
                )%}`
              },
              "Assign": {
                "targetKey": "{% $states.input.targetObject.Key %}"
              },
              "Next": "DeleteObject",
            },
            "DeleteObject": {
              "Type": "Task",
              "Resource": "arn:aws:states:::aws-sdk:s3:deleteObject",
              "Arguments": {
                "Bucket": destinationBucket.bucketName,
                "Key": "{% $targetKey %}"
              },
              "End": true,
            }
          }
        },
        "MaxConcurrency": 1000,
        "ResultWriter": {
          "Resource": "arn:aws:states:::s3:putObject",
          "Arguments": {
            "Bucket": destinationBucket.bucketName,
            "Prefix": resultWriterPrefix,
          },
        },
        "Next": "Success",
      }
    });

    const taskSuccess = new sfn.Succeed(this, 'Success', {});

    const taskFail = new sfn.Fail(this, 'Fail', {});

    const taskConfirm = new sfn.Choice(this, 'ConfirmComplete').when(
      sfn.Condition.jsonata('{% $exportTaskStatusCode = "COMPLETED" %}'),
      taskMoveLogFiles
    ).when(
      sfn.Condition.jsonata('{% $exportTaskStatusCode = "FAILED" or $exportTaskStatusCode = "CANCELLED" or $exportTaskStatusCode = "PENDING_CANCEL" %}'),
      taskFail
    ).otherwise(
      taskWait
    );

    taskPrepare
      .next(taskExport)
      .next(taskWait)
      .next(taskDescribe)
      .next(taskConfirm);

    taskMoveLogFiles.next(taskSuccess);

    // -----------------------------
    // IAM Role for Step Functions state machine
    // -----------------------------
    const stateMachineRole = new iam.Role(this, 'StateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        'policy-for-custom-state': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
              ],
              resources: [ `${destinationBucket.bucketArn}/*` ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:ListBucket',
              ],
              resources: ['*']
            }),
          ]
        })
      }
    });

    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      role: stateMachineRole,
      queryLanguage: sfn.QueryLanguage.JSONATA,
      definitionBody: sfn.DefinitionBody.fromChainable(
        taskPrepare
      ),
    });

    stateMachineRole.attachInlinePolicy(new iam.Policy(this, 'StateMachineSelfPolicy', {
      policyName: 'policy-for-state-machine',
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'states:StartExecution',
          ],
          resources: [
            stateMachine.stateMachineArn,
            `${stateMachine.stateMachineArn}/*`
          ]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'states:RedriveExecution',
          ],
          resources: [
            `arn:aws:states:${region}:${accountId}:mapRun:${stateMachine.stateMachineName}/*`,
          ]
        }),
      ]
    }))

    // -----------------------------
    // EventBridge Rule
    // -----------------------------
    new events.Rule(this, 'EventRule', {
      ruleName: 'scheduled-cloudwatch-logs-export',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '1',
        day: '*',
        month: '*',
        // weekDay: '?',
        year: '*',
      }),
      enabled: true,
      targets: [new targets.SfnStateMachine(stateMachine)],
    });

    // -----------------------------
    // Output
    // -----------------------------
    new cdk.CfnOutput(this, 'OutputDestinationBucket', {
      description: 'Destination S3 Bucket',
      value: destinationBucket.bucketName,
    });
  }
}
