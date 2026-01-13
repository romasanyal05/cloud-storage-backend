const express = require("express");
const cors = require("cors");
require("dotenv").config();
const crypto = require("crypto");

const upload = require("./middleware/upload");
const supabase = require("./supabase");
const authMiddleware = require("./middleware/authMiddleware");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   BASIC TEST ROUTE
========================= */
app.get("/", (req, res) => {
  res.send("Backend running ✅");
});

/* =========================
   AUTH ROUTES
========================= */
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return res.status(401).json({ error: error.message });

    res.json({
      message: "Login successful ✅",
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   FOLDERS API
========================= */
// CREATE folder
app.post("/api/folders", authMiddleware, async (req, res) => {
  try {
    const { name, parent_id } = req.body;

    if (!name) return res.status(400).json({ error: "Folder name required" });

    const { data, error } = await supabase
      .from("folders")
      .insert([
        {
          name,
          parent_id: parent_id || null,
          user_id: req.user.id,
        },
      ])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({
      message: "Folder created ✅",
      folder: data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET folders
app.get("/api/folders", authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("folders")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   FILE UPLOAD API
========================= */
app.post("/api/upload", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const folder_id = req.body.folder_id || null;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileName = `${Date.now()}-${file.originalname}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) {
      return res.status(500).json({ error: uploadError.message });
    }

    const filePath = uploadData.path;

    const { data: publicData } = supabase.storage.from("uploads").getPublicUrl(filePath);
    const publicUrl = publicData.publicUrl;

    const { data: savedFile, error: dbError } = await supabase
      .from("files")
      .insert([
        {
          user_id: req.user.id,
          file_name: file.originalname,
          file_path: filePath,
          public_url: publicUrl,
          file_type: file.mimetype,
          file_size: file.size,
          folder_id,
          is_deleted: false,
          deleted_at: null,
        },
      ])
      .select()
      .single();

    if (dbError) return res.status(500).json({ error: dbError.message });

    return res.status(200).json({
      message: "File uploaded & saved in DB successfully ✅",
      filePath,
      publicUrl,
      savedFile,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   FILE LIST API (Pagination)
========================= */
app.get("/api/files", authMiddleware, async (req, res) => {
  try {
    const folder_id = req.query.folder_id || null;

    const page = parseInt(req.query.page || "1");
    const limit = parseInt(req.query.limit || "10");
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from("files")
      .select("*", { count: "exact" })
      .eq("user_id", req.user.id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (folder_id) {
      query = query.eq("folder_id", folder_id);
    }

    const { data, error, count } = await query;

    if (error) return res.status(500).json({ error: error.message });

    res.json({
      page,
      limit,
      total: count,
      files: data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   FILE ACTIONS
========================= */

// RENAME
app.put("/api/files/:id/rename", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { new_name } = req.body;

    if (!new_name) return res.status(400).json({ error: "new_name required" });

    const { data, error } = await supabase
      .from("files")
      .update({ file_name: new_name })
      .eq("id", id)
      .eq("user_id", req.user.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ message: "File renamed ✅", file: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TRASH
app.delete("/api/files/:id/trash", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("files")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", req.user.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ message: "File moved to Trash ✅", file: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET TRASH
app.get("/api/trash", authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("files")
      .select("*")
      .eq("user_id", req.user.id)
      .eq("is_deleted", true)
      .order("deleted_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RESTORE
app.put("/api/files/:id/restore", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("files")
      .update({ is_deleted: false, deleted_at: null })
      .eq("id", id)
      .eq("user_id", req.user.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ message: "File restored ✅", file: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PERMANENT DELETE
app.delete("/api/files/:id/permanent", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: fileData, error: fetchError } = await supabase
      .from("files")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.user.id)
      .single();

    if (fetchError) return res.status(500).json({ error: fetchError.message });

    const { error: storageError } = await supabase.storage
      .from("uploads")
      .remove([fileData.file_path]);

    if (storageError) return res.status(500).json({ error: storageError.message });

    const { error: dbError } = await supabase
      .from("files")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user.id);

    if (dbError) return res.status(500).json({ error: dbError.message });

    res.json({ message: "File permanently deleted ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   SHARE LINKS
========================= */

// CREATE share link
app.post("/api/share/:fileId", authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;

    const { data: fileData, error: fileError } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("user_id", req.user.id)
      .single();

    if (fileError) return res.status(404).json({ error: "File not found" });

    const token = crypto.randomBytes(20).toString("hex");

    const { data: shareData, error: shareError } = await supabase
      .from("share_links")
      .insert([{ file_id: fileId, token, permission: "view" }])
      .select()
      .single();

    if (shareError) return res.status(500).json({ error: shareError.message });

    res.json({
      message: "Share link created ✅",
      share: shareData,
      shareUrl: `http://localhost:5000/api/share/access/${token}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ACCESS public share link
app.get("/api/share/access/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const { data: shareData, error: shareError } = await supabase
      .from("share_links")
      .select("*, files(*)")
      .eq("token", token)
      .single();

    if (shareError) return res.status(404).json({ error: "Invalid share link" });

    res.json({
      message: "Shared file accessed ✅",
      file: shareData.files,
      permission: shareData.permission,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   SIGNED URL (secure download)
========================= */
app.get("/api/files/:fileId/signed-url",
  
  authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;

    const { data: fileData, error } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("user_id", req.user.id)
      .single();

    if (error) return res.status(404).json({ error: "File not found" });

    const { data, error: signedError } = await supabase.storage
      .from("uploads")
      .createSignedUrl(fileData.file_path, 600);

    if (signedError) return res.status(500).json({ error: signedError.message });

    res.json({
      message: "Signed URL generated ✅",
      signedUrl: data.signedUrl,
      expiresIn: 600,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* =========================
   GOOGLE CLOUD STYLE DOWNLOAD (Redirect)
========================= */
app.get("/api/files/:fileId/download", authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;

    // 1) fetch file row
    const { data: fileData, error } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("user_id", req.user.id)
      .single();

    if (error || !fileData) {
      return res.status(404).json({ error: "File not found" });
    }

    // 2) generate signed url
    const { data, error: signedError } = await supabase.storage
      .from("uploads")
      .createSignedUrl(fileData.file_path, 600);

    if (signedError) {
      return res.status(500).json({ error: signedError.message });
    }

    // 3) redirect to signed url
    return res.redirect(data.signedUrl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* =========================
   PERMISSIONS (ADD/UPDATE/REMOVE)
========================= */

// ADD permission
app.post("/api/permissions/add", authMiddleware, async (req, res) => {
  try {
    const { file_id, user_id, role } = req.body;

    if (!file_id || !user_id || !role) {
      return res.status(400).json({ error: "file_id, user_id, role required" });
    }

    // only file owner can add permission
    const { data: fileData, error: fileErr } = await supabase
      .from("files")
      .select("*")
      .eq("id", file_id)
      .eq("user_id", req.user.id)
      .single();

    if (fileErr || !fileData) {
      return res.status(403).json({ error: "Only owner can add permission" });
    }

    const { data, error } = await supabase
      .from("permissions")
      .insert([{ owner_id: req.user.id, user_id, file_id, role }])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: "Permission added ✅", permission: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE permission
app.put("/api/permissions/update", authMiddleware, async (req, res) => {
  try {
    const { file_id, user_id, role } = req.body;

    if (!file_id || !user_id || !role) {
      return res.status(400).json({ error: "file_id, user_id, role required" });
    }

    const { data: fileData, error: fileErr } = await supabase
      .from("files")
      .select("*")
      .eq("id", file_id)
      .eq("user_id", req.user.id)
      .single();

    if (fileErr || !fileData) {
      return res.status(403).json({ error: "Only owner can update permission" });
    }

    const { data, error } = await supabase
      .from("permissions")
      .update({ role })
      .eq("file_id", file_id)
      .eq("user_id", user_id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: "Permission updated ✅", permission: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REMOVE permission
app.delete("/api/permissions/remove", authMiddleware, async (req, res) => {
  try {
    const { file_id, user_id } = req.body;

    if (!file_id || !user_id) {
      return res.status(400).json({ error: "file_id and user_id required" });
    }

    const { data: fileData, error: fileErr } = await supabase
      .from("files")
      .select("*")
      .eq("id", file_id)
      .eq("user_id", req.user.id)
      .single();

    if (fileErr || !fileData) {
      return res.status(403).json({ error: "Only owner can remove permission" });
    }

    const { error } = await supabase
      .from("permissions")
      .delete()
      .eq("file_id", file_id)
      .eq("user_id", user_id);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: "Permission removed ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   DAY 6 - SEARCH API (ILIKE)
========================= */

// search files by name
app.get("/api/search/files", authMiddleware, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
// ✅ pagination params
    const limit = parseInt(req.query.limit || "20");
    const offset = parseInt(req.query.offset || "0");

    if (!q) return res.status(400).json({ error: "q required" });

    const { data, error } = await supabase
      .from("files")
      .select("*")
      .eq("user_id", req.user.id)
      .eq("is_deleted", false)
      .ilike("file_name", `%${q}%`)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1) // ✅ scalable

    if (error) return res.status(500).json({ error: error.message });

    res.json({ query: q, results: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// search folders by name
app.get("/api/search/folders", authMiddleware, async (req, res) => {
  try {
    const q = req.query.q;

    if (!q) return res.status(400).json({ error: "q required" });

    const { data, error } = await supabase
      .from("folders")
      .select("*")
      .eq("user_id", req.user.id)
      .ilike("name", `%${q}%`)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ query: q, results: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   DAY 6 - FULL TEXT SEARCH API ✅
   (Requires search_vector column in files table)
========================= */

app.get("/api/search/fulltext", authMiddleware, async (req, res) => {
  try {
    const q = req.query.q;

    if (!q) return res.status(400).json({ error: "q required" });

    const { data, error } = await supabase
      .from("files")
      .select("*")
      .eq("user_id", req.user.id)
      .eq("is_deleted", false)
      .textSearch("search_vector", q, { type: "websearch" })
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json({
      message: "Full text search results ✅",
      query: q,
      results: data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   PROTECTED ROUTE (JWT)
========================= */
app.get("/api/protected", authMiddleware, (req, res) => {
  res.json({
    message: "Protected API accessed ✅",
    user: req.user.email,
  });
});

/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 5000;

module.exports = app;