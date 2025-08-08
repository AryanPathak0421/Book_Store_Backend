const express = require('express');
const { body, validationResult } = require('express-validator');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { verifyToken, isAdmin } = require('../middleware/auth');

const router = express.Router();

// Validation rules
const paymentValidation = [
  body('transactionId').isLength({ min: 10, max: 50 }).trim().toUpperCase(),
  body('amount').isFloat({ min: 100, max: 5000 }),
  body('upiId').optional().isEmail(),
  body('remarks').optional().isLength({ max: 500 }).trim().escape()
];

// @route   POST /api/payment/submit
// @desc    Submit payment for verification
// @access  Private
router.post('/submit', verifyToken, paymentValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { transactionId, amount, upiId, remarks } = req.body;

    // Check if user already has a pending or completed payment
    const existingPayment = await Payment.findOne({
      userId: req.user._id,
      status: { $in: ['pending', 'completed'] }
    });

    if (existingPayment) {
      return res.status(400).json({
        error: 'You already have a payment in process',
        payment: existingPayment
      });
    }

    // Check if transaction ID is already used
    const duplicateTransaction = await Payment.findOne({ transactionId });
    if (duplicateTransaction) {
      return res.status(400).json({
        error: 'This transaction ID has already been submitted'
      });
    }

    // Create new payment record
    const payment = new Payment({
      userId: req.user._id,
      transactionId,
      amount,
      upiId,
      remarks,
      membershipType: amount >= 500 ? 'premium' : 'basic',
      membershipDuration: amount >= 500 ? 24 : 12, // Premium: 2 years, Basic: 1 year
      metadata: {
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent')
      }
    });

    await payment.save();

    // Update user transaction ID
    await User.findByIdAndUpdate(req.user._id, {
      transactionId,
      paymentAmount: amount
    });

    res.status(201).json({
      success: true,
      message: 'Payment submitted for verification',
      payment: {
        id: payment._id,
        transactionId: payment.transactionId,
        amount: payment.amount,
        status: payment.status,
        paymentDate: payment.paymentDate,
        membershipType: payment.membershipType
      }
    });
  } catch (error) {
    console.error('Submit payment error:', error);
    res.status(500).json({
      error: 'Failed to submit payment'
    });
  }
});

// @route   GET /api/payment/my
// @desc    Get current user's payments
// @access  Private
router.get('/my', verifyToken, async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.user._id })
      .select('-metadata -adminNotes')
      .sort({ paymentDate: -1 });

    res.json({
      success: true,
      payments
    });
  } catch (error) {
    console.error('Get my payments error:', error);
    res.status(500).json({
      error: 'Failed to fetch payments'
    });
  }
});

// @route   GET /api/payment/qr
// @desc    Get payment QR code info
// @access  Public
router.get('/qr', (req, res) => {
  res.json({
    success: true,
    qrInfo: {
      upiId: 'college.bookstore@paytm',
      name: 'College Bookstore',
      amounts: [
        {
          type: 'basic',
          amount: 199,
          duration: '12 months',
          description: 'Access to all current semester notes'
        },
        {
          type: 'premium',
          amount: 499,
          duration: '24 months',
          description: 'Access to all semesters + priority support'
        }
      ],
      instructions: [
        'Scan the QR code with any UPI app',
        'Enter the exact amount as shown',
        'Complete the payment',
        'Copy the transaction ID from your payment app',
        'Submit the transaction ID for verification'
      ],
      note: 'Payment verification may take 2-24 hours'
    }
  });
});

// @route   GET /api/payment/all
// @desc    Get all payments (admin only)
// @access  Private/Admin
router.get('/all', verifyToken, isAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }
    if (req.query.membershipType) {
      filter.membershipType = req.query.membershipType;
    }

    const payments = await Payment.find(filter)
      .populate('userId', 'username email fullName collegeId branch semester')
      .populate('verifiedBy', 'username')
      .sort({ paymentDate: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Payment.countDocuments(filter);

    res.json({
      success: true,
      payments,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalPayments: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get all payments error:', error);
    res.status(500).json({
      error: 'Failed to fetch payments'
    });
  }
});

// @route   PUT /api/payment/:id/verify
// @desc    Verify payment (admin only)
// @access  Private/Admin
router.put('/:id/verify', verifyToken, isAdmin, [
  body('status').isIn(['completed', 'failed', 'cancelled']),
  body('adminNotes').optional().isLength({ max: 1000 }).trim().escape()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { status, adminNotes } = req.body;
    const payment = await Payment.findById(req.params.id);

    if (!payment) {
      return res.status(404).json({
        error: 'Payment not found'
      });
    }

    const user = await User.findById(payment.userId);
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Update payment status
    payment.status = status;
    payment.verificationDate = new Date();
    payment.verifiedBy = req.user._id;
    if (adminNotes) payment.adminNotes = adminNotes;

    await payment.save();

    // Update user membership status based on payment verification
    if (status === 'completed') {
      user.membershipStatus = 'active';
      user.paymentVerified = true;
      
      // Grant access to all semesters for premium membership
      if (payment.membershipType === 'premium') {
        user.semesterAccess = [1, 2, 3, 4, 5, 6, 7, 8];
      } else {
        // Basic membership: current semester + adjacent ones
        const currentSem = user.semester;
        const accessSems = [currentSem];
        if (currentSem > 1) accessSems.push(currentSem - 1);
        if (currentSem < 8) accessSems.push(currentSem + 1);
        user.semesterAccess = accessSems;
      }
    } else {
      user.membershipStatus = 'rejected';
      user.paymentVerified = false;
    }

    await user.save();

    res.json({
      success: true,
      message: `Payment ${status} successfully`,
      payment: {
        id: payment._id,
        status: payment.status,
        verificationDate: payment.verificationDate
      },
      user: {
        membershipStatus: user.membershipStatus,
        paymentVerified: user.paymentVerified,
        semesterAccess: user.semesterAccess
      }
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      error: 'Failed to verify payment'
    });
  }
});

// @route   GET /api/payment/stats
// @desc    Get payment statistics (admin only)
// @access  Private/Admin
router.get('/stats', verifyToken, isAdmin, async (req, res) => {
  try {
    const stats = await Payment.getPaymentStats();
    const monthlyRevenue = await Payment.getMonthlyRevenue();

    // Additional calculations
    const totalUsers = await User.countDocuments();
    const activeMembers = await User.countDocuments({ 
      membershipStatus: 'active',
      paymentVerified: true
    });

    const pendingPayments = await Payment.countDocuments({ status: 'pending' });
    const completedPayments = await Payment.countDocuments({ status: 'completed' });
    const totalRevenue = await Payment.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    // Recent activity
    const recentPayments = await Payment.find({ status: 'pending' })
      .populate('userId', 'username email fullName')
      .sort({ paymentDate: -1 })
      .limit(10);

    res.json({
      success: true,
      overview: {
        totalUsers,
        activeMembers,
        conversionRate: totalUsers > 0 ? ((activeMembers / totalUsers) * 100).toFixed(2) : 0,
        pendingPayments,
        completedPayments,
        totalRevenue: totalRevenue[0]?.total || 0
      },
      statusBreakdown: stats,
      monthlyRevenue,
      recentActivity: recentPayments
    });
  } catch (error) {
    console.error('Get payment stats error:', error);
    res.status(500).json({
      error: 'Failed to fetch payment statistics'
    });
  }
});

// @route   POST /api/payment/:id/refund
// @desc    Process refund (admin only)
// @access  Private/Admin
router.post('/:id/refund', verifyToken, isAdmin, [
  body('refundAmount').isFloat({ min: 0 }),
  body('refundReason').isLength({ min: 10, max: 500 }).trim().escape()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { refundAmount, refundReason } = req.body;
    const payment = await Payment.findById(req.params.id);

    if (!payment) {
      return res.status(404).json({
        error: 'Payment not found'
      });
    }

    if (payment.status !== 'completed') {
      return res.status(400).json({
        error: 'Can only refund completed payments'
      });
    }

    if (refundAmount > payment.amount) {
      return res.status(400).json({
        error: 'Refund amount cannot exceed original payment amount'
      });
    }

    // Update payment record
    payment.status = 'refunded';
    payment.refundAmount = refundAmount;
    payment.refundDate = new Date();
    payment.refundReason = refundReason;
    payment.adminNotes = `${payment.adminNotes || ''}\n\nRefund processed: ₹${refundAmount} - ${refundReason}`;

    await payment.save();

    // Update user membership status
    const user = await User.findById(payment.userId);
    if (user) {
      user.membershipStatus = 'expired';
      user.paymentVerified = false;
      user.semesterAccess = [user.semester]; // Reset to current semester only
      await user.save();
    }

    res.json({
      success: true,
      message: 'Refund processed successfully',
      refund: {
        paymentId: payment._id,
        refundAmount,
        refundDate: payment.refundDate,
        refundReason
      }
    });
  } catch (error) {
    console.error('Process refund error:', error);
    res.status(500).json({
      error: 'Failed to process refund'
    });
  }
});

module.exports = router;