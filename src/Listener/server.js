import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bodyParser from "body-parser";
import "dotenv/config";

const app = express();
const port = process.env.LISTENER_PORT;
const API_URL = process.env.BACKEND_API_URL;

mongoose.set("strictQuery", false);
mongoose.set("strictPopulate", false);
mongoose
  .connect(process.env.MONGO_URL, {
    // useNewUrlParser: true,
    // useUnifiedTopology: false,
  })
  .then(() => {
    app.use(cors({origin: API_URL}))
    app.use(bodyParser.json({ limit: "20mb" }));
    app.use(bodyParser.urlencoded({ limit: "20mb", extended: true }));

    // Health check route
    app.get("/", (req, res) => {
      res.send("Hello from pulse-trader order listener server");
    });

    // Start server
    app.listen(port, () => {
      console.log(`Server listening at http://localhost:${port}`);
    });
  });
