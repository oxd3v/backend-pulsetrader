import { addOrder, getOrder } from '../controllers/order.js';
import { getUser } from '../lib/middleware/auth.js';

export default (app) => {
    app.post("/add-order", getUser, addOrder);
    app.get("/get-order", getUser, getOrder);
};