const mongoose = require("mongoose");
const getFeedModel = require("../models/Feed");
const Device = require("../models/Device"); // Giả sử bạn có model này

const getAverageSoilMoisture = async (req, res) => {
    try {
        const userId = req.user.id;
        const feedName = req.query.feedName || "sensor-soil";
        const SensorModel = getFeedModel(feedName);

        // Lấy danh sách tất cả thiết bị của user
        const devices = await Device.find({ userId });

        const results = [];

        for (const device of devices) {
            const deviceId = device.deviceId;

            // Ngày bắt đầu 30 ngày trước
            const fromDate = new Date();
            fromDate.setDate(fromDate.getDate() - 30);

            // Lấy tất cả bản ghi 30 ngày gần nhất của thiết bị
            const data = await SensorModel.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        deviceId: deviceId,
                        createdAt: { $gte: fromDate }
                    }
                },
                {
                    $addFields: {
                        valueFloat: { $toDouble: "$value" },
                        day: {
                            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                        }
                    }
                },
                {
                    $group: {
                        _id: "$day",
                        average: { $avg: "$valueFloat" }
                    }
                },
                {
                    $sort: { _id: 1 }
                }
            ]);

            // Tính trung bình từ danh sách đã group theo ngày
            const calcAvg = (items) => {
                if (items.length === 0) return 0;
                const sum = items.reduce((acc, d) => acc + d.average, 0);
                return Number((sum / items.length).toFixed(2));
            };

            // Xử lý ngày cho last 7 ngày chính xác
            const now = new Date();
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(now.getDate() - 7);

            const last7Days = data.filter(entry => {
                const entryDate = new Date(entry._id);
                return entryDate >= sevenDaysAgo;
            });

            const last30Days = data;

            results.push({
                deviceId,
                averages: {
                    last7DaysAvg: calcAvg(last7Days),
                    last30DaysAvg: calcAvg(last30Days)
                },
                daily: data.map(entry => ({
                    date: entry._id,
                    average: Number(entry.average.toFixed(2))
                }))
            });
        }

        res.status(200).json({
            success: true,
            deviceCount: devices.length,
            results
        });

    } catch (error) {
        console.error("Error calculating averages:", error);
        res.status(500).json({
            success: false,
            message: "Đã xảy ra lỗi khi tính độ ẩm trung bình",
            error: error.message
        });
    }
};

module.exports = {
    getAverageSoilMoisture
};
