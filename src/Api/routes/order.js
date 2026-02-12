import {
  addOrder,
  deleteOrder,
  closeOrder,
  openOrder,
  getOrder,
} from "../controllers/order.js";
import { getUser } from "../lib/middleware/auth.js";

export default (app) => {
  app.post("/add-order", getUser, addOrder);
  app.post("/close-order", closeOrder);
  app.post("/open-order", openOrder);
  app.post("/delete-order", getUser, deleteOrder);
  app.get("/get-order", getUser, getOrder);
};
