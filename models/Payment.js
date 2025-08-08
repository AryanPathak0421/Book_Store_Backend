const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  transactionId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentMethod: {
    type: String,
    enum: ['UPI', 'BANK_TRANSFER', 'CASH'],
    default: 'UPI'
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled', 'refunded'],
    default: 'pending'
  },
  paymentDate: {
    type: Date,
    default: Date.now
  },
  verificationDate: Date,
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  paymentProof: {
    type: String, // URL to uploaded payment screenshot
    trim: true
  },
  upiId: {
    type: String,
    trim: true,
    lowercase: true
  },
  remarks: {
    type: String,
    trim: true,
    maxlength: 500
  },
  adminNotes: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  refundAmount: {
    type: Number,
    default: 0
  },
  refundDate: Date,
  refundReason: String,
  membershipType: {
    type: String,
    enum: ['basic', 'premium', 'lifetime'],
    default: 'basic'
  },
  membershipDuration: {
    type: Number, // in months
    default: 12
  },
  expiryDate: {
    type: Date
  },
  isRecurring: {
    type: Boolean,
    default: false
  },
  nextPaymentDate: Date,
  discountApplied: {
    code: String,
    amount: Number,
    percentage: Number
  },
  failureReason: String,
  retryCount: {
    type: Number,
    default: 0
  },
  metadata: {
    ipAddress: String,
    userAgent: String,
    deviceInfo: String
  }
}, {
  timestamps: true
});

// Indexes
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ transactionId: 1 });
paymentSchema.index({ paymentDate: -1 });
paymentSchema.index({ status: 1, verificationDate: 1 });

// Virtual for payment age
paymentSchema.virtual('paymentAge').get(function() {
  const now = new Date();
  const diffTime = Math.abs(now - this.paymentDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Virtual for formatted amount
paymentSchema.virtual('formattedAmount').get(function() {
  return `₹${this.amount.toFixed(2)}`;
});

// Method to check if payment is expired for verification
paymentSchema.methods.isExpiredForVerification = function() {
  const maxVerificationTime = 7 * 24 * 60 * 60 * 1000; // 7 days
  return this.status === 'pending' && (Date.now() - this.paymentDate.getTime()) > maxVerificationTime;
};

// Method to calculate membership expiry
paymentSchema.methods.calculateExpiryDate = function() {
  if (this.membershipType === 'lifetime') {
    // Set expiry to 100 years from now for lifetime membership
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 100);
    return expiry;
  }
  
  const expiry = new Date(this.paymentDate);
  expiry.setMonth(expiry.getMonth() + this.membershipDuration);
  return expiry;
};

// Pre-save middleware to set expiry date
paymentSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('membershipDuration') || this.isModified('membershipType')) {
    this.expiryDate = this.calculateExpiryDate();
  }
  next();
});

// Static method to get payment statistics
paymentSchema.statics.getPaymentStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    }
  ]);
  
  return stats;
};

// Static method to get revenue by month
paymentSchema.statics.getMonthlyRevenue = async function(year = new Date().getFullYear()) {
  const stats = await this.aggregate([
    {
      $match: {
        status: 'completed',
        paymentDate: {
          $gte: new Date(year, 0, 1),
          $lt: new Date(year + 1, 0, 1)
        }
      }
    },
    {
      $group: {
        _id: { month: { $month: '$paymentDate' } },
        revenue: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { '_id.month': 1 }
    }
  ]);
  
  return stats;
};

module.exports = mongoose.model('Payment', paymentSchema);