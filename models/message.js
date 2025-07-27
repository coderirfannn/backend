const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: [true, "Sender ID is required"],
    index: true
  },
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: [true, "Recipient ID is required"],
    index: true
  },
  messageType: {
    type: String,
    enum: ["text", "image"],
    required: [true, "Message type is required"]
  },
  message: {
    type: String,
    required: function() {
      return this.messageType === "text";
    },
    validate: {
      validator: function(v) {
        if (this.messageType === "text") {
          return v && v.trim().length > 0;
        }
        return true;
      },
      message: "Message text cannot be empty for text messages"
    }
  },
  imageUrl: {
    type: String,
    required: function() {
      return this.messageType === "image";
    }
  },
  status: {
    type: String,
    enum: ["sent", "delivered", "read"],
    default: "sent"
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt fields
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for faster querying
messageSchema.index({ senderId: 1, recipientId: 1 });
messageSchema.index({ createdAt: -1 });

// Virtual populate (if you need to reference messages in users)
messageSchema.virtual("sender", {
  ref: "User",
  localField: "senderId",
  foreignField: "_id",
  justOne: true
});

messageSchema.virtual("recipient", {
  ref: "User",
  localField: "recipientId",
  foreignField: "_id",
  justOne: true
});

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;
