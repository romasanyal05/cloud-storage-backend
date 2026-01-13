const supabase = require("../supabase");
const authMiddleware = async (req, res, next) => {
  try {
    // 1️⃣ Token header से निकालो
    const authHeader = req.headers.authorization;
    console.log("AUTH HEADER >>>", authHeader);
    console.log("REQ HEADERS >>>", req.headers);
    console.log("TOKEN >>>", authHeader?.split(" ")[1]);
    if (!authHeader) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    // 2️⃣ Supabase से token verify
    const { data, error } = await supabase.auth.getUser(token);

    if (error) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // 3️⃣ User request में attach करो
    req.user = data.user;

    next(); // ✅ allow request

  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
};

module.exports = authMiddleware;