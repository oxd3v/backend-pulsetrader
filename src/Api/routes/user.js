import { checkUser, connect, join, disconnectUser, getEncryptedPrivateKey, createInvitationCode, deleteInvitationCode, addToken, createNewWallet, withdrawBalance} from '../controllers/user.js';
import { getUser, joinUser } from '../lib/middleware/auth.js';
export default (app) => {
    app.post("/join-user", join);
    app.post("/withdraw-fund", getUser, withdrawBalance);
    app.post('/add-token', getUser, addToken);
    app.get("/check-user", checkUser); 
    app.post('/connect', connect);
    app.post('/disconnect', getUser, disconnectUser);
    app.get("/get-private-key", getUser, getEncryptedPrivateKey);
    app.post("/create-invitation-code", getUser, createInvitationCode);
    app.post("/delete-invitation-code", getUser, deleteInvitationCode);
    app.post('/create-new-wallet', getUser, createNewWallet)
    //app.get("/protocol-info", protocolInfo);
    //app.post('/cash-out-fund', getUser, cashOut);
};