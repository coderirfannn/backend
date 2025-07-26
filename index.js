const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const jwt = require("jsonwebtoken");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const User = require("./models/user");
const Message = require("./models/message");

const app = express();
const port = 8000;

// Create files directory if it doesn't exist
const filesDir = path.join(__dirname, "files");
if (!fs.existsSync(filesDir)) {
  fs.mkdirSync(filesDir, { recursive: true });
}

// Security middleware
app.use(helmet());

app.use(cors({
  origin: '*',  // 🚨 WARNING: Accepts all origins (safe only for testing)
  credentials: true,
}));


// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body parsing
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(passport.initialize());

// Serve static files
app.use("/files", express.static(filesDir));

// MongoDB connection
mongoose.connect("mongodb+srv://mohdirfan70097:yb9jVLDQ5oWIvNnN@cluster0.mta1qfl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0", {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("Connected to MongoDB"))
.catch(err => console.error("MongoDB connection error:", err));

// JWT Secret Key
const JWT_SECRET = "Q$r2K6W8n!qewfrgww%Zk"; // In production, use environment variable

// Configure multer for handling file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, filesDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Enhanced register endpoint
app.post("/register", async (req, res) => {
  try {
    const { name, email, password, image } = req.body;
    
    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const newUser = new User({ name, email, password, image });
    await newUser.save();
    
    res.status(201).json({ 
      message: "User registered successfully",
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        image: newUser.image
      }
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Token creator
const createToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1h" });
};

// Enhanced login endpoint
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.password !== password) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = createToken(user._id);
    res.status(200).json({ 
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        image: user.image
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get all users except the logged-in user
app.get("/users/:userId", async (req, res) => {
  try {
    const loggedInUserId = req.params.userId;

    // Get logged-in user to access friends & sentFriendRequests
    const loggedInUser = await User.findById(loggedInUserId).lean();
    if (!loggedInUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const sentRequestsSet = new Set(
      (loggedInUser.sentFriendRequests || []).map(id => id.toString())
    );

    const friendsSet = new Set(
      (loggedInUser.friends || []).map(id => id.toString())
    );

    // Get all other users
    const users = await User.find({ _id: { $ne: loggedInUserId } }).lean();

    // Enrich each user with request/friendship status
    const enrichedUsers = users.map(user => ({
      _id: user._id,
      name: user.name,
      email: user.email,
      image: user.image,
      hasPendingRequest: sentRequestsSet.has(user._id.toString()),
      isFriend: friendsSet.has(user._id.toString())
    }));

    res.status(200).json(enrichedUsers);
  } catch (err) {
    console.error("Error retrieving users:", err);
    res.status(500).json({ message: "Error retrieving users" });
  }
});

// Friend request endpoint
app.post("/friend-request", async (req, res) => {
  const { senderId, recipientId } = req.body;

  try {
    // Check if users exist
    const [sender, recipient] = await Promise.all([
      User.findById(senderId),
      User.findById(recipientId)
    ]);

    if (!sender || !recipient) {
      return res.status(404).json({ 
        success: false,
        message: "User not found"
      });
    }

    // Check if request already exists
    if (recipient.freindRequests.includes(senderId)) {
      return res.status(400).json({
        success: false,
        message: "Friend request already sent"
      });
    }

    // Check if already friends
    if (sender.friends.includes(recipientId)) {
      return res.status(400).json({
        success: false,
        message: "Already friends"
      });
    }

    // Update the recipient's friendRequests array
    await User.findByIdAndUpdate(recipientId, {
      $push: { freindRequests: senderId },
    });

    // Update the sender's sentFriendRequests array
    await User.findByIdAndUpdate(senderId, {
      $push: { sentFriendRequests: recipientId },
    });

    res.status(200).json({
      success: true,
      message: "Friend request sent successfully"
    });
  } catch (error) {
    console.error("Friend request error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});

// Get friend requests for a user
app.get("/friend-request/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId)
      .populate("freindRequests", "name email image")
      .lean();

    res.json(user.freindRequests);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Accept friend request
app.post("/friend-request/accept", async (req, res) => {
  try {
    const { senderId, recepientId } = req.body;

    const [sender, recepient] = await Promise.all([
      User.findById(senderId),
      User.findById(recepientId)
    ]);

    if (!sender || !recepient) {
      return res.status(404).json({ message: "User not found" });
    }

    sender.friends.push(recepientId);
    recepient.friends.push(senderId);

    recepient.freindRequests = recepient.freindRequests.filter(
      (request) => request.toString() !== senderId.toString()
    );

    sender.sentFriendRequests = sender.sentFriendRequests.filter(
      (request) => request.toString() !== recepientId.toString()
    );

    await Promise.all([sender.save(), recepient.save()]);

    res.status(200).json({ message: "Friend Request accepted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Get accepted friends
app.get("/accepted-friends/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).populate(
      "friends",
      "name email image"
    );
    res.json(user.friends);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Logout endpoint
app.post("/logout", (req, res) => {
  res.status(200).json({ message: "Logged out successfully" });
});

// Enhanced message sending endpoint
// In your API index.js (backend)
app.post("/messages", upload.single("imageFile"), async (req, res) => {
  try {
    const { senderId, recepientId, messageType, messageText } = req.body;

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(senderId) || 
        !mongoose.Types.ObjectId.isValid(recepientId)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid user IDs provided" 
      });
    }

    // Rest of your message handling code...
  } catch (error) {
    console.error("Message sending error:", error);
    res.status(500).json({ 
      success: false,
      error: "Internal Server Error",
      details: error.message
    });
  }
});
// Get user details endpoint
app.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Enhanced message fetching endpoint
app.get("/messages/:senderId/:recepientId", async (req, res) => {
  try {
    const { senderId, recepientId } = req.params;

    const messages = await Message.find({
      $or: [
        { senderId: senderId, recepientId: recepientId },
        { senderId: recepientId, recepientId: senderId },
      ],
    })
    .populate("senderId", "_id name image")
    .sort({ timestamp: 1 });

    res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Delete messages endpoint
app.post("/deleteMessages", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ message: "Invalid request body" });
    }

    await Message.deleteMany({ _id: { $in: messages } });

    res.json({ message: "Messages deleted successfully" });
  } catch (error) {
    console.error("Error deleting messages:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get sent friend requests
app.get("/friend-requests/sent/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId)
      .populate("sentFriendRequests", "name email image")
      .lean();

    res.json(user.sentFriendRequests);
  } catch (error) {
    console.error("Error fetching sent requests:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get friends list
app.get("/friends/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).populate("friends");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const friendIds = user.friends.map((friend) => friend._id);
    res.status(200).json(friendIds);
  } catch (error) {
    console.error("Error fetching friends:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get friends with details
app.get("/friends-with-details/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId)
      .populate("friends", "name email image lastSeen");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user.friends);
  } catch (error) {
    console.error("Error fetching friends with details:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

app.get("/", (req, res) => {
  res.send("I am Running")
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

// Start server
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});