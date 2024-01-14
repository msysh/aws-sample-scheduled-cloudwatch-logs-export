import * as cdk from 'aws-cdk-lib';
import { Stack } from '../lib/stack';

const app = new cdk.App();
new Stack(app, 'ScheduledCloudwatchLogsExport', {});