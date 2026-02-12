import ActivityLogModel from "../../model/activity.js";
import logger from "../../logger.js";

export const addActivity = async ({
  walletId,
  userId,
  status,
  indexTokenAddress,
  receiveToken,
  payToken,
  type,
  chainId,
  txHash,
  feeToken,
  txFee,
  receiver = undefined,
  orderId = undefined,
}) => {
  try {
    const activityLog = new ActivityLogModel({
      wallet: walletId,
      user: userId,
      ...(orderId && { order: orderId }),
      status,
      indexToken: indexTokenAddress,
      txHash,
      payToken,
      ...(receiveToken && receiveToken),
      ...(receiver && receiver),
      txFee,
      ...(feeToken && feeToken),
      type,
      chainId,
    });
    await activityLog.save();
    return activityLog._id;
  } catch (activityErr) {
    logger.error({
      id: `${type}_ACTIVITY_SAVE_FAILED`,
      ...(orderId && { order: orderId }),
      user: userId,
      error: activityErr.message,
    });
  }
};

export const updateActivity = async ({
  activityId,
  updates
}) => {
  const updatePayload = {};
   const fieldMap = {
     status: 'status',
     receiveInUsd : 'receiveToken.amountInUsd',
     payInUsd: 'payToken.amountInUsd',
     txFeeInUsd: 'txFee.feeInUsd'
   };
 
   Object.keys(updates).forEach((key) => {
     if (updates[key] !== undefined && fieldMap[key]) {
       const val = updates[key];
       updatePayload[fieldMap[key]] =
         typeof val === "bigint" ? val.toString() : val;
     }
   });
 
   return await ActivityLogModel.updateOne({ _id: activityId }, { $set: updatePayload });
};
