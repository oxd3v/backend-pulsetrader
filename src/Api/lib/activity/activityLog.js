import ActivityLogModel from "../../model/activity.js";
import logger from '../../logger.js';


export const addActivity = async ({walletId, userId, status, indexTokenAddress, receiveToken, payToken, type, chainId, txHash, feeToken, txFee, receiver=undefined, orderId=undefined})=>{
    try{
    const activityLog = new ActivityLogModel({
       wallet: walletId,
       user: userId,
       ...(orderId && {order: orderId}),
       status,
       indexToken:indexTokenAddress,
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
   }catch(err){
    logger.error(err.message || 'activity log save failed')
   }
}