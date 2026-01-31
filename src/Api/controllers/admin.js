import {
  startOrderListening,
  stopOrderListening,
} from "../../Listener/listen/order/listener.js";
import {
  startTokenListening,
  stopTokenListening,
} from "../../Listener/listen/token.js";

export const switchOrderListening = async (req, res) => {
  let user = req.user;
  if (user.status != "admin") {
    return res.status(400).send({ message: "User isnt admin" });
  }
  let { shouldListen } = req.body;
  try {
    if (shouldListen) {
      startOrderListening();
    } else {
      stopOrderListening();
    }
    return res
      .status(200)
      .send({ message: "Successfully switch listen order" });
  } catch (err) {
    return res
      .status(500)
      .send({ message: err.message || "Switch listen order failed" });
  }
};

export const switchTokenListening = async (req, res) => {
  let user = req.user;
  if (user.status != "admin") {
    return res.status(400).send({ message: "User isnt admin" });
  }
  let { shouldListen } = req.body;
  try {
    if (shouldListen) {
      startTokenListening();
    } else {
      stopTokenListening();
    }
    return res
      .status(200)
      .send({ message: "Successfully switch token price listener" });
  } catch (err) {
    return res
      .status(500)
      .send({ message: err.message || "Switch listen token price failed" });
  }
};
