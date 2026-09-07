const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pool = require("../config/db");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { body, validationResult } = require("express-validator");

// ──────────────────────────────────────────
// Multer config for profile photo uploads
// ──────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "..", "uploads", "profiles");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = `member-${req.user.id}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, unique);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only JPEG, PNG, or WebP images are allowed."), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024 },
}); // 3MB max

// ──────────────────────────────────────────
// GET /api/members  — Public list of approved members
// ──────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    // Fix #1: Remove 'status' from the public SELECT — members should not be
    // able to probe whether another user is 'financial' vs 'approved'.
    const { search, classSet, industry, status } = req.query;
    let sql = `SELECT id, title, first_name, last_name, class_set,
                      profession, company, industry, city, state,
                      photo_url, linkedin, bio
               FROM members
               WHERE role = 'member' AND status IN ('approved','financial')`;
    const params = [];

    if (search) {
      sql +=
        " AND (first_name LIKE ? OR last_name LIKE ? OR profession LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (classSet) {
      sql += " AND class_set = ?";
      params.push(classSet);
    }
    if (industry) {
      sql += " AND industry = ?";
      params.push(industry);
    }
    if (status === "financial") {
      sql += " AND status = ?";
      params.push("financial");
    }

    sql += " ORDER BY first_name ASC";

    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /members error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

// ──────────────────────────────────────────
// GET /api/members/stats  — Admin dashboard stats
// ──────────────────────────────────────────
router.get("/stats", auth, adminOnly, async (req, res) => {
  try {
    // Fix #9: Consolidate 5 separate COUNT queries into a single round-trip.
    const [[counts]] = await pool.execute(`
      SELECT
        SUM(role = 'member')     AS total,
        SUM(status = 'pending')  AS pending,
        SUM(status = 'financial') AS financial,
        (SELECT COUNT(*) FROM news   WHERE status = 'published') AS newsCount,
        (SELECT COUNT(*) FROM events)                            AS evCount
      FROM members
    `);

    const [activity] = await pool.execute(
      `SELECT al.action, al.created_at,
              m.first_name, m.last_name
       FROM activity_log al
       LEFT JOIN members m ON al.member_id = m.id
       ORDER BY al.created_at DESC LIMIT 10`,
    );

    res.json({
      total: Number(counts.total) || 0,
      pending: Number(counts.pending) || 0,
      financial: Number(counts.financial) || 0,
      newsCount: Number(counts.newsCount) || 0,
      evCount: Number(counts.evCount) || 0,
      activity,
    });
  } catch (err) {
    console.error("GET /members/stats error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

// ──────────────────────────────────────────
// GET /api/members/pending  — Admin: pending approvals
// ──────────────────────────────────────────
router.get("/pending", auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, title, first_name, last_name, email, phone,
              class_set, profession, city, state, ref_number, created_at
       FROM members WHERE status = 'pending' AND role = 'member'
       ORDER BY created_at ASC`,
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /members/pending error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

// ──────────────────────────────────────────
// GET /api/members/all  — Admin: all members with all fields
// ──────────────────────────────────────────
router.get("/all", auth, adminOnly, async (req, res) => {
  try {
    const { search, status } = req.query;
    let sql = `SELECT id, title, first_name, last_name, email, phone,
                      class_set, profession, city, state, status, role,
                      ref_number, created_at
               FROM members WHERE role = 'member'`;
    const params = [];

    if (search) {
      sql += " AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }

    sql += " ORDER BY created_at DESC";

    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /members/all error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

// ──────────────────────────────────────────
// GET /api/members/:id  — Single member profile (public)
// ──────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    // Fix #1: Remove 'status' from the public profile SELECT.
    const [rows] = await pool.execute(
      `SELECT m.id, m.title, m.first_name, m.last_name, m.email, m.phone,
              m.gender, m.house,
              (SELECT COUNT(*) FROM nominations n
               WHERE n.nominee_member_id = m.id AND n.status = 'selected')
          AS alumni_of_month_count,
              m.class_set, m.profession, m.company, m.industry, m.city, m.state,
              m.photo_url, m.linkedin, m.bio
             FROM members m WHERE m.id = ? AND m.status IN ('approved','financial')`,
      [req.params.id],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Member not found." });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /members/:id error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

// ──────────────────────────────────────────
// POST /api/members/me/photo  — Upload own profile photo
// ──────────────────────────────────────────
router.post("/me/photo", auth, upload.single("photo"), async (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: "No image file provided." });

  const photoUrl = `/uploads/profiles/${req.file.filename}`;

  try {
    // Remove old photo from disk if it was a locally-uploaded one
    const [rows] = await pool.execute(
      "SELECT photo_url FROM members WHERE id = ?",
      [req.user.id],
    );
    if (
      rows.length > 0 &&
      rows[0].photo_url &&
      rows[0].photo_url.startsWith("/uploads/profiles/")
    ) {
      const oldPath = path.join(__dirname, "..", rows[0].photo_url);
      fs.unlink(oldPath, (err) => {
        if (err && err.code !== "ENOENT")
          console.warn("Could not delete old photo:", err.message);
      });
    }

    await pool.execute("UPDATE members SET photo_url = ? WHERE id = ?", [
      photoUrl,
      req.user.id,
    ]);
    res.json({ message: "Profile photo updated.", photoUrl });
  } catch (err) {
    console.error("POST /members/me/photo error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

// Fix #5: Validators for profile update — guard against oversized payloads.
const profileUpdateValidators = [
  body("phone")
    .optional()
    .isLength({ max: 20 })
    .withMessage("Phone number is too long"),
  body("city")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("City name is too long"),
  body("state")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("State name is too long"),
  body("gender")
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage("Gender is too long"),
  body("house")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("House / set name is too long"),
  body("profession")
    .optional()
    .trim()
    .isLength({ max: 150 })
    .withMessage("Profession is too long"),
  body("company")
    .optional()
    .trim()
    .isLength({ max: 150 })
    .withMessage("Company name is too long"),
  body("industry")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Industry is too long"),
  body("linkedin")
    .optional({ checkFalsy: true })
    .trim()
    .isURL()
    .isLength({ max: 255 })
    .withMessage("LinkedIn must be a valid URL"),
  body("bio")
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Bio must be 2000 characters or fewer"),
];

router.put("/:id", auth, profileUpdateValidators, async (req, res) => {
  const memberId = parseInt(req.params.id);
  // Members can only update their own profile; admins can update anyone
  if (req.user.role !== "admin" && req.user.id !== memberId) {
    return res.status(403).json({ error: "Not authorised." });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ errors: errors.array() });

  const {
    phone,
    city,
    state,
    gender,
    house,
    profession,
    company,
    industry,
    linkedin,
    bio,
  } = req.body;

  try {
    await pool.execute(
      `UPDATE members SET phone=?, city=?, state=?, gender=?, house=?, profession=?,
              company=?, industry=?, linkedin=?, bio=?
       WHERE id=?`,
      [
        phone,
        city,
        state,
        gender,
        house,
        profession,
        company,
        industry,
        linkedin,
        bio,
        memberId,
      ],
    );
    res.json({ message: "Profile updated successfully." });
  } catch (err) {
    console.error("PUT /members/:id error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

// ──────────────────────────────────────────
// PUT /api/members/:id/approve  — Admin approves a member
// ──────────────────────────────────────────
router.put("/:id/approve", auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT first_name, last_name FROM members WHERE id = ?",
      [req.params.id],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Member not found." });

    await pool.execute("UPDATE members SET status = 'approved' WHERE id = ?", [
      req.params.id,
    ]);

    const m = rows[0];
    await pool.execute(
      "INSERT INTO activity_log (member_id, action) VALUES (?, ?)",
      [
        req.params.id,
        `${m.first_name} ${m.last_name}'s membership was approved.`,
      ],
    );

    res.json({ message: "Member approved successfully." });
  } catch (err) {
    console.error("PUT /approve error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

// ──────────────────────────────────────────
// PUT /api/members/:id/reject  — Admin rejects a member
// ──────────────────────────────────────────
router.put("/:id/reject", auth, adminOnly, async (req, res) => {
  try {
    await pool.execute("UPDATE members SET status = 'rejected' WHERE id = ?", [
      req.params.id,
    ]);
    res.json({ message: "Member rejected." });
  } catch (err) {
    console.error("PUT /reject error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

// ──────────────────────────────────────────
// DELETE /api/members/:id  — Admin removes a member
// ──────────────────────────────────────────
router.delete("/:id", auth, adminOnly, async (req, res) => {
  try {
    console.log("Attempting delete for member id:", req.params.id);
    const [result] = await pool.execute("DELETE FROM members WHERE id = ?", [
      req.params.id,
    ]);
    console.log("Delete result:", result);
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ error: "Member not found or could not be deleted." });
    }
    res.json({ message: "Member removed." });
  } catch (err) {
    console.error("DELETE /members/:id error:", err);
    res.status(500).json({ error: "Server error." });
  }
});

module.exports = router;
