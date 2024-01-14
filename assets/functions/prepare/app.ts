import {
  Handler,
  Context,
} from 'aws-lambda';

const EXPORT_TARGET_BUCKET_NAME = process.env.EXPORT_TARGET_BUCKET_NAME;

const getCurrentDate = (event: any): Date => {
  if ('currentDate' in event){
    // For debug : ISO8601 format
    console.debug(`Specifed currentDate: ${event['currentDate']}`)
    return new Date(event['currentDate']);
  }
  return new Date();
};

const getExportTargetDate = (currentDate: Date): Date => {
  const yesterday = new Date(currentDate.getTime());
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday;
};

const getExportFromTime = (lastDate: Date): number => {
  const fromDate = new Date(lastDate.getTime());
  fromDate.setUTCHours(0);
  fromDate.setUTCMinutes(0);
  fromDate.setUTCSeconds(0);
  fromDate.setUTCMilliseconds(0);
  return fromDate.getTime();
}

const getExportToTime = (lastDate: Date): number => {
  const toDate = new Date(lastDate.getTime());
  toDate.setUTCHours(23);
  toDate.setUTCMinutes(59);
  toDate.setUTCSeconds(59);
  toDate.setUTCMilliseconds(999);
  return toDate.getTime();
}

const getDestinationPrefix = (targetDate: Date): string => {
  const year = targetDate.getUTCFullYear();
  const month = ('00' + (targetDate.getUTCMonth() + 1)).slice(-2);
  const day = ('00' + (targetDate.getUTCDate())).slice(-2);
  return `${year}/${month}/${day}`;
};

export const handler: Handler = async (event, context: Context) => {
  console.debug(event);

  const currentDate = getCurrentDate(event);
  const exportTargetDate = getExportTargetDate(currentDate);
  const exportFromTime = getExportFromTime(exportTargetDate);
  const exportToTime = getExportToTime(exportTargetDate);
  console.info(`Export from: ${exportFromTime} - to: ${exportToTime}`);

  const destinationPrefix = getDestinationPrefix(exportTargetDate);
  console.info(`Export destination: ${EXPORT_TARGET_BUCKET_NAME}/${destinationPrefix}`);

  return {
    destinationBucket: EXPORT_TARGET_BUCKET_NAME,
    destinationPrefix: destinationPrefix,
    from: exportFromTime,
    to: exportToTime,
  };
};
