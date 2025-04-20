// controllers/modeController.js
const mongoose = require("mongoose");
const getFeedModel = require("../models/Feed"); // dynamic feed model

/**
 * Fetch mode data for a specific device and user,
 * filter out consecutive identical values,
 * and count occurrences of 0 (auto) and 1 (manual).
 */
const getModeSummary = async (req, res) => {
    try {
        const userId = req.user.id;
        const { deviceId, feedName = 'pump-motor' } = req.query;

        if (!deviceId) {
            return res.status(400).json({ success: false, message: 'Missing deviceId' });
        }

        const ModeModel = getFeedModel(feedName);

        // Fetch all mode records ordered by createdAt ascending
        const records = await ModeModel.find({
            userId: new mongoose.Types.ObjectId(userId),
            deviceId
        }).sort({ createdAt: 1 }).lean();

        if (!records.length) {
            return res.status(200).json({
                success: true,
                autoMode: 0,
                manualMode: 0,
                totalTransitions: 0,
                filtered: []
            });
        }

        // Filter out consecutive duplicates
        const filtered = records.reduce((acc, cur) => {
            if (acc.length === 0 || acc[acc.length - 1].value !== cur.value) {
                acc.push(cur);
            }
            return acc;
        }, []);

        // Count modes
        let autoMode = 0;
        let manualMode = 0;
        filtered.forEach(r => {
            if (r.value === '0') autoMode++;
            else if (r.value === '1') manualMode++;
        });

        // Count transitions from "0" to "1"
        let totalTransitions = 0;
        for (let i = 0; i < filtered.length - 1; i++) {
            if (filtered[i].value === '0' && filtered[i + 1].value === '1') {
                totalTransitions++;
            }
        }

        res.status(200).json({
            success: true,
            autoMode,
            manualMode,
            total: totalTransitions,
            filtered
        });
    } catch (error) {
        console.error('Error in getPumpMotorSummary:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};


const getCleanedModeSummary = async (req, res) => {
    try {
        const userId = req.user.id;
        const feedName = req.query.feedName || "pump-motor";
        const deviceId = req.query.deviceId || null;
        const ModeModel = getFeedModel(feedName);

        const query = { userId };
        if (deviceId) query.deviceId = deviceId;

        const allModes = await ModeModel.find(query).sort({ createdAt: 1 });

        // Remove consecutive duplicate values
        const cleaned = [];
        let lastValue = null;
        for (const entry of allModes) {
            if (entry.value !== lastValue) {
                cleaned.push(entry);
                lastValue = entry.value;
            }
        }

        // Đếm số lần chuyển từ "0" sang "1"
        let transitionCount = 0;
        for (let i = 0; i < cleaned.length - 1; i++) {
            if (cleaned[i].value === "0" && cleaned[i + 1].value === "1") {
                transitionCount++;
            }
        }

        // Đếm tổng số mode
        let autoMode = 0;
        let manualMode = 0;
        cleaned.forEach(entry => {
            if (entry.value === "0") autoMode++;
            if (entry.value === "1") manualMode++;
        });

        return res.status(200).json({
            success: true,
            autoMode,
            manualMode,
            total: transitionCount,
            filtered: cleaned
        });

    } catch (err) {
        console.error("Error getting cleaned pump-motor summary:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};



module.exports = { getModeSummary, getCleanedModeSummary };
