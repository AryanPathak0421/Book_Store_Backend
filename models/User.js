const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  collegeId: {
    type: String,
    required: true,
    trim: true
  },
  branch: {
    type: String,
    required: true,
    enum: ['CSE', 'ECE', 'ME', 'CE', 'EE', 'IT', 'OTHER']
  },
  semester: {
    type: Number,
    required: true,
    min: 1,
    max: 8
  },
  membershipStatus: {
    type: String,
    enum: ['pending', 'active', 'expired', 'rejected'],
    default: 'pending'
  },
  paymentVerified: {
    type: Boolean,
    default: false
  },
  transactionId: {
    type: String,
    trim: true
  },
  paymentAmount: {
    type: Number,
    default: 199 // Membership fee
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  semesterAccess: [{
    type: Number,
    min: 1,
    max: 8
  }],
  lastLogin: {
    type: Date
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: String,
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  profilePicture: {
    type: String,
    default: ''
  },
  totalDownloads: {
    type: Number,
    default: 0
  },
  joinedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for performance
userSchema.index({ email: 1, username: 1 });

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to get public profile
userSchema.methods.getPublicProfile = function() {
  const user = this.toObject();
  delete user.password;
  delete user.verificationToken;
  delete user.resetPasswordToken;
  delete user.resetPasswordExpires;
  return user;
};

// Virtual for membership duration
userSchema.virtual('membershipDuration').get(function() {
  if (this.membershipStatus === 'active') {
    const monthsActive = Math.floor((Date.now() - this.joinedAt) / (1000 * 60 * 60 * 24 * 30));
    return monthsActive;
  }
  return 0;
});

module.exports = mongoose.model('User', userSchema);