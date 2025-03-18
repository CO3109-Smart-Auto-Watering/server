const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const router = express.Router();
const getPumpModel = require("../models/PumpModel"); // Import dynamic model

const AIO_USERNAME = process.env.AIO_USERNAME;
const AIO_KEY = process.env.AIO_KEY;

// 📌 API GET: Lấy toàn bộ dữ liệu của một máy bơm (Lịch sử trạng thái)
router.get("/:pumpName", async (req, res) => {
    try {
      const pumpName = req.params.pumpName;
  
      // 📌 Lấy model máy bơm theo tên (nếu chưa có thì tạo collection)
      const PumpModel = getPumpModel(pumpName);
  
      // 📌 Lấy toàn bộ lịch sử máy bơm, chỉ lấy các trường cần thiết
      const history = await PumpModel.find({}, { _id: 1, status: 1, updatedAt: 1, __v: 1 });
  
      res.json(history);
    } catch (err) {
      console.error("Error:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  });

// 📌 API POST: Bật/Tắt máy bơm & Lưu vào lịch sử
router.post("/:pumpName", async (req, res) => {
  try {
    const { status } = req.body;
    const pumpName = req.params.pumpName;

    if (!["ON", "OFF"].includes(status)) {
      return res.status(400).json({ message: "Invalid status, must be 'ON' or 'OFF'" });
    }

    // 📌 Gửi trạng thái lên Adafruit IO
    const aioResponse = await axios.post(
      `https://io.adafruit.com/api/v2/${AIO_USERNAME}/feeds/${pumpName}/data`,
      { value: status },
      { headers: { "X-AIO-Key": AIO_KEY, "Content-Type": "application/json" } }
    );

    if (aioResponse.status !== 200) {
      return res.status(500).json({ message: "Failed to update Adafruit IO" });
    }

    // 📌 Lấy model máy bơm theo tên
    const PumpModel = getPumpModel(pumpName);

    // 📌 Lấy trạng thái gần nhất
    const lastRecord = await PumpModel.findOne().sort({ updatedAt: -1 });

    // 📌 Nếu trạng thái thay đổi, thêm mới vào lịch sử
    if (!lastRecord || lastRecord.status !== status) {
      const newPumpData = new PumpModel({ status });
      await newPumpData.save();
      console.log(`Pump ${pumpName} changed to ${status}`);
    }

    res.json({ message: `Pump ${pumpName} is now ${status}` });

  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
