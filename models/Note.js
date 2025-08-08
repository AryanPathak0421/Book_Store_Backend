const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  semester: {
    type: Number,
    required: true,
    min: 1,
    max: 8
  },
  branch: {
    type: String,
    required: true,
    enum: ['CSE', 'ECE', 'ME', 'CE', 'EE', 'IT', 'ALL']
  },
  category: {
    type: String,
    enum: ['notes', 'books', 'question-papers', 'assignments', 'presentations'],
    default: 'notes'
  },
  fileUrl: {
    type: String,
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number, // in bytes
    required: true
  },
  fileType: {
    type: String,
    enum: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt'],
    required: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  uploadDate: {
    type: Date,
    default: Date.now
  },
  downloads: {
    type: Number,
    default: 0
  },
  views: {
    type: Number,
    default: 0
  },
  ratings: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    review: String,
    date: {
      type: Date,
      default: Date.now
    }
  }],
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  verified: {
    type: Boolean,
    default: false
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verificationDate: Date,
  isActive: {
    type: Boolean,
    default: true
  },
  reportCount: {
    type: Number,
    default: 0
  },
  lastModified: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better query performance
noteSchema.index({ semester: 1, subject: 1, branch: 1 });
noteSchema.index({ uploadedBy: 1 });
noteSchema.index({ verified: 1, isActive: 1 });
noteSchema.index({ tags: 1 });

// Virtual for formatted file size
noteSchema.virtual('formattedFileSize').get(function() {
  const bytes = this.fileSize;
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
});

// Method to calculate average rating
noteSchema.methods.calculateAverageRating = function() {
  if (this.ratings.length === 0) {
    this.averageRating = 0;
    return 0;
  }
  
  const sum = this.ratings.reduce((total, rating) => total + rating.rating, 0);
  this.averageRating = Math.round((sum / this.ratings.length) * 10) / 10;
  return this.averageRating;
};

// Static method to get subjects by semester
noteSchema.statics.getSubjectsBySemester = function(semester) {
  const subjects = {
    1: ['Mathematics-I', 'Physics', 'Chemistry', 'Programming', 'Engineering Graphics', 'Communication Skills'],
    2: ['Mathematics-II', 'Physics-II', 'Chemistry-II', 'Data Structures', 'Digital Logic', 'Environmental Studies'],
    3: ['Mathematics-III', 'Computer Organization', 'Database Systems', 'Operating Systems', 'Software Engineering', 'Technical Communication'],
    4: ['Mathematics-IV', 'Computer Networks', 'Algorithms', 'System Programming', 'Web Technology', 'Economics'],
    5: ['Machine Learning', 'Compiler Design', 'Computer Graphics', 'Distributed Systems', 'Elective-I', 'Project-I'],
    6: ['Artificial Intelligence', 'Mobile Computing', 'Cloud Computing', 'Information Security', 'Elective-II', 'Project-II'],
    7: ['Big Data Analytics', 'IoT', 'Blockchain', 'Advanced Networks', 'Elective-III', 'Major Project-I'],
    8: ['Industry Training', 'Capstone Project', 'Research Methodology', 'Entrepreneurship', 'Elective-IV', 'Major Project-II']
  };
  
  return subjects[semester] || [];
};

// Pre-save middleware
noteSchema.pre('save', function(next) {
  this.lastModified = Date.now();
  next();
});

module.exports = mongoose.model('Note', noteSchema);