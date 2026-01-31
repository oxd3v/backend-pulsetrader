import UserModel from "../../model/user.js";
import { decodeText, decryptAuthToken } from "../crypto/encryption.js";
import { verifyMessage } from "ethers";
import { SIGN_MESSAGE } from "../../constant/common/user.js";
import 'dotenv/config';

const FRONTEND_AUTH_SECURITY = process.env.FRONT_END_AUTH_TOKEN_SECURITY_PASSWORD


export const getUser = async (req, res, next) => {
    try {
        const bearerToken = req.headers['authorization'];
        const token = bearerToken?.split(' ')[1];
        if (!token) {
            return res.status(401).send({ message: 'Token Not found' });
        }
        if (!FRONTEND_AUTH_SECURITY) {
            return res.status(401).send({ message: 'Token validation Failed' });
        }
        let address;
        try {
            let decryptedText = decryptAuthToken(token, FRONTEND_AUTH_SECURITY)
            let decode = JSON.parse(decodeText(decryptedText));
            if (decode.ExpireAt <= Date.now()) {
                return res.status(401).send({ message: 'Token expired' });
            }
            address = verifyMessage(SIGN_MESSAGE, decode.signature);
        }
        catch (error) {
            //console.log(error)
            return res.status(401).send({ message: 'Token authentication failed' });
        }
        if (!address)
            return res.status(401).send({ message: 'Authentication err' });
        const user = await UserModel.findOne({ account: { $regex: address, $options: "i" } });
        if (!user)
            return res.status(401).send({ message: 'Authentication err' });
        req.user = user;
        next();
    }
    catch (error) {
        //console.log(error);
        return res.status(401).send({ message: 'Authentication error' });
    }
};

export const joinUser = async (req, res, next) => {
    try {
        const bearerToken = req.headers['authorization'];
        const token = bearerToken?.split(' ')[1];
        if (!token) {
            return res.status(401).send({ message: 'Token not found' });
        }
        let address;
        try {
            let decryptedText = decryptAuthToken(token, FRONTEND_AUTH_SECURITY)
            let decode = JSON.parse(decodeText(decryptedText));
            if (decode.ExpireAt < Date.now()) {
                return res.status(401).send({ message: 'Token expired' });
            }
            try {
                address = verifyMessage(SIGN_MESSAGE, decode.signature);
            }
            catch (error) {
                return res.status(401).send({ message: 'Unauthorized token' });
            }
        }
        catch (error) {
            return res.status(401).send({ message: 'Unauthorized token' });
        }
        if (!address) {
            return res.status(401).send({ message: 'Authentication err' });
        }
        req.account = address;
        next();
    }
    catch (error) {
        //console.error(error);
        return res.status(401).send({ message: 'Authentication error' });
    }
};

