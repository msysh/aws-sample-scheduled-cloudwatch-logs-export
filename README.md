# Scheduled export for Amazon CloudWatch Logs

This is a sample solution with AWS CDK. It exports CloudWatch Logs of last day for daily.

The logs exported by CloudWatch Logs are stored in folders separated by task ID on S3, which can make searching the logs later from Athena more complex. This sample solution moves the exported logs into `yyyy/MM/dd` folders instead. Each log file is renamed to `<LogStream Name>-<Sequential Number>.gz`. See the "[Log files layout](#log-files-layout)" for more details.

## Architecture

![Step Functions state machine flow](./doc/images/architecture.svg)

## Pre-requirement

This project are provisioned by the AWS Cloud Development Kit (CDK). If you have not installed the CDK, first install it by referring to the [documents](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html).

## How to deploy

### 1. Specify LogGroup

[Specify an exporting LogGroup in CDK code](./lib/stack.ts#L19)

```typescript
const targetLogGroupName = '<Please specify an exportin LogGroup>';
```

### 2. Specify execution timing

[Specify an exection timing in CDK code](./lib/stack.ts#L301-#L308)

```typescript
schedule: events.Schedule.cron({
  minute: '0',
  hour: '1',
  day: '*',
  month: '*',
  // weekDay: '?',
  year: '*',
}),
```

If you want specify by `rate`, following:

```typescript
schedule: events.Schedule.rate(
  cdk.Duration.hours(24)
),
```

#### (Optional)

Since the parameters of `CreateExportTask`, `From` and `To`, are specified in Lambda, if necessary, please customize the [Lambda function](./assets/functions/prepare/app.ts).

### 3. Deploy AWS resources

```sh
cdk deploy
```

If you have never run `cdk` command, firstly you may need to run `cdk bootstrap`.

## Debug execution

> [!Tip]
> If you want to execute Step Functions state machine for debug, you can put any timing as current date (UTC) to input parameter. Please specify in ISO 8601 format.

```json
{
  "currentDate": "2024-01-01T01:23:45"
}
```

## Attention!!

> [!WARNING]
> If the log stream name contains a slash(`/`), the final log file name (after moving it) will be incorrect. Please correct the part of the [CDK code](./lib/stack.ts#L186) that does the object key for the destination.

```json
{
  //  :
  // (snip)
  //  :
  "Key.$": "States.Format('{}/{}-{}', $.destinationPrefix, States.ArrayGetItem(States.StringSplit($.value.Key, '/'), 2), States.ArrayGetItem(States.StringSplit($.value.Key, '/'), 3))"
}
```

## Log files layout

Exported files by `CreateExportTask` are stored in following:

```
bucket-name
  + (prefix: if specified)
    + <Export Task ID>
      + <Log Stream Name>
        + 000000.gz (Sequential number)
            :
            :
```

This sample solution moves log files into following:

```
bucket-name
  + yyyy
    + MM
      + dd
        + <Log Stream Name>-000000.gz
                     :
                     :
```

> [!Tip]
> `yyyy/MM/dd` is identified at the [papare Lambda function](./assets/functions/prepare/app.ts#L41-L46) as destination prefix. If you want to change it, please customize the function.

## Clean up

If you want to remove this solution, please execute following command:

```sh
cdk destroy
```

The S3 Bucket for log files destination is remaining. If you want to delete the bucket, manual deletion using management console.

## License

MIT
