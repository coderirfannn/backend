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
const crypto = require("crypto");
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
  origin: process.env.CORS_ORIGIN || '*', // Better to configure specific origins
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
mongoose.connect(process.env.MONGODB_URI || "mongodb+srv://mohdirfan70097:yb9jVLDQ5oWIvNnN@cluster0.mta1qfl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0", {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("Connected to MongoDB"))
.catch(err => console.error("MongoDB connection error:", err));

// JWT Secret Key - Use environment variable in production
const JWT_SECRET = process.env.JWT_SECRET || "Q$r2K6W8n!qewfrgww%Zk";

// Configure multer for handling file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, filesDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + crypto.randomBytes(8).toString('hex');
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

    const users = await User.find({ _id: { $ne: loggedInUserId } }).lean();

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

    if (recipient.freindRequests.includes(senderId)) {
      return res.status(400).json({
        success: false,
        message: "Friend request already sent"
      });
    }

    if (sender.friends.includes(recipientId)) {
      return res.status(400).json({
        success: false,
        message: "Already friends"
      });
    }

    await User.findByIdAndUpdate(recipientId, {
      $push: { freindRequests: senderId },
    });

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
    const { senderId, recipientId } = req.body;

    const [sender, recipient] = await Promise.all([
      User.findById(senderId),
      User.findById(recipientId)
    ]);

    if (!sender || !recipient) {
      return res.status(404).json({ message: "User not found" });
    }

    sender.friends.push(recipientId);
    recipient.friends.push(senderId);

    recipient.freindRequests = recipient.freindRequests.filter(
      (request) => request.toString() !== senderId.toString()
    );

    sender.sentFriendRequests = sender.sentFriendRequests.filter(
      (request) => request.toString() !== recipientId.toString()
    );

    await Promise.all([sender.save(), recipient.save()]);

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

// Message sending endpoint
app.post("/messages", upload.single("imageFile"), async (req, res) => {
  try {
    const { senderId, recipientId, messageType, messageText } = req.body;
    const imageFile = req.file;

    if (!senderId || !recipientId || !messageType) {
      return res.status(400).json({ 
        success: false,
        error: "senderId, recipientId, and messageType are required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(senderId) || 
        !mongoose.Types.ObjectId.isValid(recipientId)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid user IDs provided"
      });
    }

    const validMessageTypes = ["text", "image"];
    if (!validMessageTypes.includes(messageType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid message type. Must be one of: ${validMessageTypes.join(', ')}`
      });
    }

    if (messageType === "text" && !messageText?.trim()) {
      return res.status(400).json({
        success: false,
        error: "Message text is required for text messages"
      });
    }

    if (messageType === "image" && !imageFile) {
      return res.status(400).json({
        success: false,
        error: "Image file is required for image messages"
      });
    }

    const [sender, recipient] = await Promise.all([
      User.findById(senderId),
      User.findById(recipientId)
    ]);

    if (!sender || !recipient) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const messageData = {
      senderId,
      recipientId,
      messageType,
      timestamp: new Date()
    };

    if (messageType === "text") {
      messageData.message = messageText.trim();
    } else {
      const fileExt = path.extname(imageFile.originalname);
      const fileName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${fileExt}`;
      const filePath = path.join(filesDir, fileName);
      
      await fs.promises.rename(imageFile.path, filePath);
      messageData.imageUrl = `/files/${fileName}`;
    }

    const newMessage = new Message(messageData);
    await newMessage.save();

    return res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: newMessage
    });

  } catch (error) {
    console.error("Message sending error:", error);
    
    if (req.file?.path) {
      try {
        await fs.promises.unlink(req.file.path);
      } catch (cleanupError) {
        console.error("Failed to cleanup uploaded file:", cleanupError);
      }
    }

    return res.status(500).json({ 
      success: false,
      error: "Internal Server Error",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

// Get messages between two users
app.get("/messages/:senderId/:recipientId", async (req, res) => {
  try {
    const { senderId, recipientId } = req.params;

    const messages = await Message.find({
      $or: [
        { senderId: senderId, recipientId: recipientId },
        { senderId: recipientId, recipientId: senderId },
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

// Get user details
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

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

app.get("/", (req, res) => {
  res.send("Chat Server is Running");
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
