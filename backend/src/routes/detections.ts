import { Router, Request, Response } from "express";
import { FlaggedEvent } from "../lib/models/flaggedEvent";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const skip  = (page - 1) * limit;

    const [total, data] = await Promise.all([
      FlaggedEvent.countDocuments(),
      FlaggedEvent.find()
        .sort({ detectedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    res.json({
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("[detections] error:", err?.message ?? err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
