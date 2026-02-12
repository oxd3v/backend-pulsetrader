import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bodyParser from "body-parser";
import cookieParser from 'cookie-parser';
import "dotenv/config";

import OrderRoute from "../Api/routes/order.js";
import UserRoute from "../Api/routes/user.js";


import { startTokenListening } from "../Listener/listen/token.js";
import { startOrderListening } from '../Listener/listen/order/listener.js';

const app = express();
const port = process.env.API_PORT;

//const allowedOrigins = ["http://localhost:3000", "http://192.168.0.101:3000"];

mongoose.set("strictQuery", false);
mongoose.set("strictPopulate", false);
mongoose
  .connect(process.env.MONGO_URL, {
    // useNewUrlParser: true,
    // useUnifiedTopology: false,
  })
  .then(() => {
    app.use(
      cors({
        origin: process.env.FRONT_END_API_URL,
        credentials: true
      }),
    );
    app.use(cookieParser());
    app.use(bodyParser.json({ limit: "20mb" }));
    app.use(bodyParser.urlencoded({ limit: "20mb", extended: true }));
    startTokenListening();
    startOrderListening();
    // Health check route
    app.get("/", (req, res) => {
      res.send("Hello from pulse-trader order api server");
    });

    OrderRoute(app);
    UserRoute(app);

    // Start server
    app.listen(port, () => {
      console.log(`Server listening at http://localhost:${port}`);
    });
  });
