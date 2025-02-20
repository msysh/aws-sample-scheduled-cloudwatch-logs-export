# Scheduled export for Amazon CloudWatch Logs

This is a sample solution with AWS CDK. It exports CloudWatch Logs of last day for daily.

The logs exported by CloudWatch Logs are stored in folders separated by task ID on S3, which can make searching the logs later from Athena more complex. This sample solution moves the exported logs into `yyyy/MM/dd` folders instead. Each log file is renamed to `<LogStream Name>-<Sequential Number>.gz`. See the "[Log files layout](#log-files-layout)" for more details.

## Architecture

![Step Functions state machine flow](./doc/images/architecture.svg)

## Pre-requirement

This project are provisioned by the AWS Cloud Development Kit (CDK). If you have not installed the CDK, first install it by referring to the [documents](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html).

## How to deploy

### 1. Specify LogGroup

[Specify an exporting LogGroup in CDK code](./lib/stack.ts#L17)

```typescript
const targetLogGroupName = '<Please specify an exporting LogGroup>';
```

### 2. Specify execution timing

[Specify an execution timing in CDK code](./lib/stack.ts#L293-#L300)

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

Since the parameters of `CreateExportTask`, `From` and `To`, are specified at the [Prepare state with JSONata](./lib/stack.ts#L89-L100), if necessary, please customize the it.

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
  + (Destination Prefix: if specified, default is "exported-logs")
    + yyyy
      + MM
        + dd
          + <Log Stream Name>-000000.gz
                     :
                     :
```

> [!Tip]
> `yyyy/MM/dd` is identified at the [Prepare state with JSONata](./lib/stack.ts#L89-L100) as destination date prefix. If you want to change it, you can customize it.

> [!Tip]
> Task results for moving files are stored at `<Destination Bucket>/result-write-logs-for-moving-files/<TaskID>/*`. If you want to change the prefix, you can modify at [here](./lib/stack.ts#L20).

## Clean up

If you want to remove this solution, please execute following command:

```sh
cdk destroy
```

The S3 Bucket for log files destination is remaining. If you want to delete the bucket, manual deletion using management console.

## License

MIT
