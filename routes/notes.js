const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { body, validationResult } = require('express-validator');
const Note = require('../models/Note');
const User = require('../models/User');
const { verifyToken, hasActiveMembership, downloadRateLimit, isAdmin, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/notes');
    try {
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExtension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + fileExtension);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOC, DOCX, PPT, PPTX, and TXT files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Validation rules
const noteValidation = [
  body('title').isLength({ min: 5, max: 200 }).trim().escape(),
  body('description').optional().isLength({ max: 1000 }).trim().escape(),
  body('subject').isLength({ min: 2, max: 100 }).trim(),
  body('semester').isInt({ min: 1, max: 8 }),
  body('branch').isIn(['CSE', 'ECE', 'ME', 'CE', 'EE', 'IT', 'ALL']),
  body('category').optional().isIn(['notes', 'books', 'question-papers', 'assignments', 'presentations']),
  body('tags').optional().isArray()
];

// @route   GET /api/notes
// @desc    Get all notes with filters
// @access  Public (limited info) / Private (full access)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = { isActive: true };
    
    if (req.query.semester) {
      filter.semester = parseInt(req.query.semester);
    }
    
    if (req.query.subject) {
      filter.subject = new RegExp(req.query.subject, 'i');
    }
    
    if (req.query.branch && req.query.branch !== 'ALL') {
      filter.$or = [
        { branch: req.query.branch },
        { branch: 'ALL' }
      ];
    }
    
    if (req.query.category) {
      filter.category = req.query.category;
    }
    
    if (req.query.verified !== undefined) {
      filter.verified = req.query.verified === 'true';
    }
    
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      filter.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { subject: searchRegex },
        { tags: { $in: [searchRegex] } }
      ];
    }

    // Sorting options
    let sortOption = { createdAt: -1 }; // Default: newest first
    
    if (req.query.sortBy) {
      switch (req.query.sortBy) {
        case 'downloads':
          sortOption = { downloads: -1 };
          break;
        case 'rating':
          sortOption = { averageRating: -1 };
          break;
        case 'title':
          sortOption = { title: 1 };
          break;
        case 'date':
          sortOption = { createdAt: -1 };
          break;
      }
    }

    const notes = await Note.find(filter)
      .populate('uploadedBy', 'username fullName')
      .populate('verifiedBy', 'username')
      .sort(sortOption)
      .skip(skip)
      .limit(limit);

    const total = await Note.countDocuments(filter);

    // Filter sensitive information for non-members
    const filteredNotes = notes.map(note => {
      const noteObj = note.toObject();
      
      // If user is not authenticated or doesn't have active membership
      if (!req.user || req.user.membershipStatus !== 'active' || !req.user.paymentVerified) {
        delete noteObj.fileUrl; // Hide download link
        noteObj.restricted = true;
      }
      
      return noteObj;
    });

    res.json({
      success: true,
      notes: filteredNotes,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalNotes: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({
      error: 'Failed to fetch notes'
    });
  }
});

// @route   GET /api/notes/subjects/:semester
// @desc    Get subjects for a specific semester
// @access  Public
router.get('/subjects/:semester', async (req, res) => {
  try {
    const semester = parseInt(req.params.semester);
    
    if (semester < 1 || semester > 8) {
      return res.status(400).json({
        error: 'Invalid semester. Must be between 1 and 8.'
      });
    }

    const subjects = Note.getSubjectsBySemester(semester);
    
    // Get subjects that actually have notes in the database
    const availableSubjects = await Note.distinct('subject', { 
      semester, 
      isActive: true 
    });

    res.json({
      success: true,
      semester,
      standardSubjects: subjects,
      availableSubjects: availableSubjects.sort()
    });
  } catch (error) {
    console.error('Get subjects error:', error);
    res.status(500).json({
      error: 'Failed to fetch subjects'
    });
  }
});

// @route   GET /api/notes/:id
// @desc    Get single note by ID
// @access  Private (members only)
router.get('/:id', verifyToken, hasActiveMembership, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id)
      .populate('uploadedBy', 'username fullName branch semester')
      .populate('verifiedBy', 'username')
      .populate('ratings.user', 'username');

    if (!note || !note.isActive) {
      return res.status(404).json({
        error: 'Note not found'
      });
    }

    // Increment view count
    note.views += 1;
    await note.save();

    res.json({
      success: true,
      note
    });
  } catch (error) {
    console.error('Get note error:', error);
    res.status(500).json({
      error: 'Failed to fetch note'
    });
  }
});

// @route   POST /api/notes
// @desc    Upload new note
// @access  Private (members only)
router.post('/', verifyToken, hasActiveMembership, upload.single('file'), noteValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Clean up uploaded file if validation fails
      if (req.file) {
        await fs.unlink(req.file.path).catch(console.error);
      }
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded'
      });
    }

    const { title, description, subject, semester, branch, category, tags } = req.body;

    // Determine file type
    const fileExtension = path.extname(req.file.originalname).toLowerCase().substring(1);
    const fileType = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt'].includes(fileExtension) 
      ? fileExtension 
      : 'pdf';

    const note = new Note({
      title,
      description,
      subject,
      semester: parseInt(semester),
      branch,
      category: category || 'notes',
      fileUrl: `/uploads/notes/${req.file.filename}`,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType,
      uploadedBy: req.user._id,
      tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(tag => tag.trim()) : [])
    });

    await note.save();

    const populatedNote = await Note.findById(note._id)
      .populate('uploadedBy', 'username fullName');

    res.status(201).json({
      success: true,
      message: 'Note uploaded successfully',
      note: populatedNote
    });
  } catch (error) {
    console.error('Upload note error:', error);
    
    // Clean up uploaded file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(console.error);
    }
    
    res.status(500).json({
      error: 'Failed to upload note'
    });
  }
});

// @route   PUT /api/notes/:id
// @desc    Update note
// @access  Private (owner or admin)
router.put('/:id', verifyToken, noteValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const note = await Note.findById(req.params.id);
    
    if (!note) {
      return res.status(404).json({
        error: 'Note not found'
      });
    }

    // Check if user owns the note or is admin
    if (note.uploadedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied. You can only edit your own notes.'
      });
    }

    const { title, description, subject, semester, branch, category, tags } = req.body;

    note.title = title;
    note.description = description;
    note.subject = subject;
    note.semester = parseInt(semester);
    note.branch = branch;
    note.category = category;
    note.tags = Array.isArray(tags) ? tags : (tags ? tags.split(',').map(tag => tag.trim()) : []);
    note.lastModified = new Date();

    await note.save();

    const updatedNote = await Note.findById(note._id)
      .populate('uploadedBy', 'username fullName');

    res.json({
      success: true,
      message: 'Note updated successfully',
      note: updatedNote
    });
  } catch (error) {
    console.error('Update note error:', error);
    res.status(500).json({
      error: 'Failed to update note'
    });
  }
});

// @route   DELETE /api/notes/:id
// @desc    Delete note
// @access  Private (owner or admin)
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    
    if (!note) {
      return res.status(404).json({
        error: 'Note not found'
      });
    }

    // Check if user owns the note or is admin
    if (note.uploadedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied. You can only delete your own notes.'
      });
    }

    // Soft delete - mark as inactive instead of permanently deleting
    note.isActive = false;
    await note.save();

    // Optional: Delete the actual file
    if (req.query.permanent === 'true' && req.user.role === 'admin') {
      try {
        const filePath = path.join(__dirname, '..', note.fileUrl);
        await fs.unlink(filePath);
      } catch (fileError) {
        console.error('File deletion error:', fileError);
      }
      
      await Note.findByIdAndDelete(note._id);
    }

    res.json({
      success: true,
      message: 'Note deleted successfully'
    });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({
      error: 'Failed to delete note'
    });
  }
});

// @route   POST /api/notes/:id/download
// @desc    Download note file
// @access  Private (members only)
router.post('/:id/download', verifyToken, hasActiveMembership, downloadRateLimit, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    
    if (!note || !note.isActive) {
      return res.status(404).json({
        error: 'Note not found'
      });
    }

    const filePath = path.join(__dirname, '..', note.fileUrl);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        error: 'File not found on server'
      });
    }

    // Increment download count
    note.downloads += 1;
    await note.save();

    // Update user's total downloads
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { totalDownloads: 1 }
    });

    // Send file
    res.download(filePath, note.fileName, (error) => {
      if (error) {
        console.error('File download error:', error);
        res.status(500).json({
          error: 'Failed to download file'
        });
      }
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({
      error: 'Failed to download note'
    });
  }
});

// @route   POST /api/notes/:id/rate
// @desc    Rate a note
// @access  Private (members only)
router.post('/:id/rate', verifyToken, hasActiveMembership, [
  body('rating').isInt({ min: 1, max: 5 }),
  body('review').optional().isLength({ max: 500 }).trim().escape()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { rating, review } = req.body;
    const note = await Note.findById(req.params.id);
    
    if (!note || !note.isActive) {
      return res.status(404).json({
        error: 'Note not found'
      });
    }

    // Check if user already rated this note
    const existingRatingIndex = note.ratings.findIndex(
      r => r.user.toString() === req.user._id.toString()
    );

    if (existingRatingIndex > -1) {
      // Update existing rating
      note.ratings[existingRatingIndex].rating = rating;
      note.ratings[existingRatingIndex].review = review || '';
      note.ratings[existingRatingIndex].date = new Date();
    } else {
      // Add new rating
      note.ratings.push({
        user: req.user._id,
        rating,
        review: review || '',
        date: new Date()
      });
    }

    // Recalculate average rating
    note.calculateAverageRating();
    await note.save();

    res.json({
      success: true,
      message: existingRatingIndex > -1 ? 'Rating updated successfully' : 'Rating added successfully',
      averageRating: note.averageRating,
      totalRatings: note.ratings.length
    });
  } catch (error) {
    console.error('Rate note error:', error);
    res.status(500).json({
      error: 'Failed to rate note'
    });
  }
});

// @route   PUT /api/notes/:id/verify
// @desc    Verify/unverify a note (admin only)
// @access  Private/Admin
router.put('/:id/verify', verifyToken, isAdmin, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    
    if (!note) {
      return res.status(404).json({
        error: 'Note not found'
      });
    }

    note.verified = !note.verified;
    if (note.verified) {
      note.verifiedBy = req.user._id;
      note.verificationDate = new Date();
    } else {
      note.verifiedBy = undefined;
      note.verificationDate = undefined;
    }

    await note.save();

    res.json({
      success: true,
      message: `Note ${note.verified ? 'verified' : 'unverified'} successfully`,
      verified: note.verified
    });
  } catch (error) {
    console.error('Verify note error:', error);
    res.status(500).json({
      error: 'Failed to verify note'
    });
  }
});

// @route   GET /api/notes/my/uploads
// @desc    Get current user's uploaded notes
// @access  Private
router.get('/my/uploads', verifyToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const notes = await Note.find({ 
      uploadedBy: req.user._id,
      isActive: true
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Note.countDocuments({ 
      uploadedBy: req.user._id,
      isActive: true
    });

    res.json({
      success: true,
      notes,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalNotes: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get my uploads error:', error);
    res.status(500).json({
      error: 'Failed to fetch your uploads'
    });
  }
});

// @route   GET /api/notes/stats
// @desc    Get notes statistics
// @access  Public
router.get('/stats', async (req, res) => {
  try {
    const stats = await Note.aggregate([
      {
        $match: { isActive: true }
      },
      {
        $group: {
          _id: null,
          totalNotes: { $sum: 1 },
          totalDownloads: { $sum: '$downloads' },
          totalViews: { $sum: '$views' },
          verifiedNotes: {
            $sum: { $cond: ['$verified', 1, 0] }
          }
        }
      }
    ]);

    const semesterStats = await Note.aggregate([
      {
        $match: { isActive: true }
      },
      {
        $group: {
          _id: '$semester',
          count: { $sum: 1 },
          totalDownloads: { $sum: '$downloads' }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    const branchStats = await Note.aggregate([
      {
        $match: { isActive: true }
      },
      {
        $group: {
          _id: '$branch',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    const categoryStats = await Note.aggregate([
      {
        $match: { isActive: true }
      },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    res.json({
      success: true,
      overview: stats[0] || {
        totalNotes: 0,
        totalDownloads: 0,
        totalViews: 0,
        verifiedNotes: 0
      },
      bySemester: semesterStats,
      byBranch: branchStats,
      byCategory: categoryStats
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      error: 'Failed to fetch statistics'
    });
  }
});

module.exports = router;