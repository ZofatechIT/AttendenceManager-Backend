import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import ImageKit from 'imagekit';

dotenv.config();

// Ensure assets directory exists
const assetsDir = path.join(process.cwd(), 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir);
}

const imagekit = new ImageKit({
  publicKey: 'public_Go7RnwiDRbJZMJsy7ZZljlZITqo=',
  privateKey: 'private_Ps1Zl4X0Ex4XL/PHNf8qSDfsipI=',
  urlEndpoint: 'https://ik.imagekit.io/nwkqadfgr',
});

// Helper to upload a file to ImageKit
async function uploadToImageKit(filePath, fileName, folder = '/attendence_manager') {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const result = await imagekit.upload({
      file: fileBuffer,
      fileName: fileName,
      folder: folder,
    });
    return result.url;
  } catch (err) {
    console.error('Error uploading to ImageKit:', err);
    return null;
  }
}

const app = express();

// CORS setup for frontend
app.use(cors({
  origin: [
    'https://attendence-manager-frontend.vercel.app',
    'http://localhost:5173',
    'http://localhost:5001',
    '*'
  ],
  credentials: true
}));
app.use(express.json());


// app.use((req, res, next) => {
//   console.log(`${req.method} ${req.originalUrl}`);
//   next();
// });
// Basic health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Attendance Manager Backend Running' });
});

// Login API
app.post('/api/login', async (req, res) => {
  try {
    const { employeeId, password } = req.body;
    if (!employeeId || !password) {
      return res.status(400).json({ message: 'Employee ID and password are required' });
    }
    const user = await User.findOne({ employeeId });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: 'Invalid credentials' });
    
    // Generate access token (short-lived) and refresh token (long-lived)
    const accessToken = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '1h' });
    const refreshToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '30d' });
    
    const userWithLocation = await User.findById(user._id).populate('location');
    res.json({ 
      token: accessToken, 
      refreshToken: refreshToken,
      user: userWithLocation 
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Token refresh API
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }
    
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET || 'your-secret-key');
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }
    
    // Generate new access token
    const newAccessToken = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '1h' });
    const newRefreshToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '30d' });
    
    res.json({ 
      token: newAccessToken, 
      refreshToken: newRefreshToken 
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(401).json({ message: 'Invalid refresh token' });
  }
});


// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something broke!' });
});


mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('MongoDB connected');
}).catch((err) => {
  console.error('MongoDB connection error:', err);
});

// Set up multer for file uploads
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    cb(null, base + '-' + Date.now() + ext);
  }
});
const upload = multer({ storage });

app.use('/uploads', express.static(uploadDir));

const userSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: String,
  isAdmin: { type: Boolean, default: false },
  email: String,
  phone: String,
  address: String,
  profilePic: String, // URL or path
  idDocs: [String],   // Array of URLs or paths
  location: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
});

const User = mongoose.model('User', userSchema);

const locationSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
});
const Location= mongoose.model('Location', locationSchema);


const jobPostSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
});
const JobPost = mongoose.model('JobPost', jobPostSchema);

const attendanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  startTime: String,
  lunchStartTime: String,
  lunchEndTime: String,
  endTime: String,
  locations: [{ time: String, lat: Number, lng: Number }],
  totalHours: Number,
});
const Attendance = mongoose.model('Attendance', attendanceSchema);

const reportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['all_ok', 'problem', 'security', 'maintenance', 'suspicious', 'equipment', 'other'], 
    required: true 
  },
  date: { type: String, required: true }, // YYYY-MM-DD
  time: { type: String, required: true }, // HH:MM
  message: { type: String, required: true },
  location: { type: String },
  pictures: [String], // Array of ImageKit URLs
  createdAt: { type: Date, default: Date.now },
});
const Report = mongoose.model('Report', reportSchema);

// Helper to format time as 'h:mm:ss AM/PM'
function formatTime(t) {
  if (!t) return '';
  const d = new Date(t);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
}

// Helper to update Excel file: one worksheet per user, with Employee ID and Name columns
async function updateExcelPerUserSheet(user, att, type, lat, lng) {
  try {
    const fileName = 'attendence.xlsx';
    const filePath = path.join(process.cwd(), '..', 'assets', fileName);
    const columns = [
      'Employee ID', 'Name', 'Date', 'Begin Work', 'Lunch', 'Return From Lunch', 'End Work', 'Total', 'Remarks (loc)'
    ];
    const dateStr = att.date;
    let workbook = new ExcelJS.Workbook();
    if (fs.existsSync(filePath)) {
      await workbook.xlsx.readFile(filePath);
    }
    // Use employeeId as worksheet name
    let wsName = user.employeeId;
    let worksheet = workbook.getWorksheet(wsName);
    if (!worksheet) {
      worksheet = workbook.addWorksheet(wsName);
      worksheet.addRow(columns);
    }
    // Find row for today
    let rows = worksheet.getSheetValues().slice(2); // skip header and 1-based index
    let rowObj = rows.find(r => r && r[3] === dateStr);
    let row;
    if (rowObj) {
      row = worksheet.getRow(rows.indexOf(rowObj) + 2);
    }
    if (!row) {
      row = worksheet.addRow([user.employeeId, user.name, dateStr, '', '', '', '', '', '']);
    }
    // Update columns
    if (type === 'start') row.getCell(4).value = formatTime(att.startTime);
    if (type === 'lunchStart') row.getCell(5).value = formatTime(att.lunchStartTime);
    if (type === 'lunchEnd') row.getCell(6).value = formatTime(att.lunchEndTime);
    if (type === 'end') {
      row.getCell(7).value = formatTime(att.endTime);
      row.getCell(8).value = att.totalHours ? att.totalHours.toFixed(2) : '';
    }
    // Add location to remarks
    if (lat && lng) {
      row.getCell(9).value = `Lat: ${lat}, Lng: ${lng}`;
    }
    await workbook.xlsx.writeFile(filePath);
  } catch (error) {
    console.error('Failed to update Excel file. It might be open or locked.', error);
  }
}

// Helper to update a full row in the Excel file for a user
async function updateExcelRow(user, att) {
  try {
    const fileName = 'attendence.xlsx';
    const filePath = path.join(process.cwd(), '..', 'assets', fileName);
    const columns = [
      'Employee ID', 'Name', 'Date', 'Begin Work', 'Lunch', 'Return From Lunch', 'End Work', 'Total', 'Remarks (loc)'
    ];
    const dateStr = att.date;
    let workbook = new ExcelJS.Workbook();
    if (fs.existsSync(filePath)) {
      await workbook.xlsx.readFile(filePath);
    }
    
    let worksheet = workbook.getWorksheet(user.employeeId);
    if (!worksheet) {
      worksheet = workbook.addWorksheet(user.employeeId);
      worksheet.addRow(columns);
    }

    let rowIndex = -1;
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (row.getCell(3).value === dateStr) {
        rowIndex = rowNumber;
      }
    });

    let row;
    if (rowIndex !== -1) {
      row = worksheet.getRow(rowIndex);
    } else {
      row = worksheet.addRow([]); // New row if date not found
    }
    
    row.values = [
      user.employeeId,
      user.name,
      dateStr,
      formatTime(att.startTime),
      formatTime(att.lunchStartTime),
      formatTime(att.lunchEndTime),
      formatTime(att.endTime),
      att.totalHours ? att.totalHours.toFixed(2) : '',
      row.getCell(9).value || '' // Preserve remarks
    ];

    await workbook.xlsx.writeFile(filePath);
  } catch (error) {
    console.error('Failed to update Excel row. It might be locked.', error);
  }
}

// Signup API (no frontend)
app.post('/api/signup', async (req, res) => {
  try {
    const { employeeId, password, name, isAdmin } = req.body;
    const existing = await User.findOne({ employeeId });
    if (existing) return res.status(400).json({ message: 'Employee ID already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ employeeId, password: hashed, name, isAdmin });
    await user.save();
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Middleware to verify JWT
// function auth(req, res, next) {
//   const token = req.headers.authorization?.split(' ')[1];
//   if (!token) return res.status(401).json({ message: 'No token' });
//   try {
//     req.user = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
//     next();
//   } catch {
//     res.status(401).json({ message: 'Invalid token' });
//   }
// }
//  chat gpt auth funtion
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ message: 'No token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    console.log('JWT verified, user:', decoded);
    next();
  } catch (err) {
    console.error('JWT verification failed:', err.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// Record attendance event
app.post('/api/attendance', auth, async (req, res) => {
  const { type, time, lat, lng } = req.body;
  const date = new Date().toISOString().slice(0, 10);
  let att = await Attendance.findOne({ userId: req.user.id, date });
  if (!att) att = new Attendance({ userId: req.user.id, date, locations: [] });
  if (type === 'start') att.startTime = time;
  if (type === 'lunch_start') att.lunchStartTime = time;
  if (type === 'lunch_end') att.lunchEndTime = time;
  if (type === 'end') att.endTime = time;
  if (lat && lng) att.locations.push({ time, lat, lng });
  
  // Calculate total hours with proper validation
  if (type === 'end' && att.startTime && att.endTime) {
    try {
      // Validate and parse dates
      const startDate = new Date(att.startTime);
      const endDate = new Date(att.endTime);
      
      // Check if dates are valid
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        console.error('Invalid date values:', { startTime: att.startTime, endTime: att.endTime });
        att.totalHours = 0;
      } else {
        let ms = endDate.getTime() - startDate.getTime();
        
        // Validate lunch times if they exist
        if (att.lunchStartTime && att.lunchEndTime) {
          const lunchStartDate = new Date(att.lunchStartTime);
          const lunchEndDate = new Date(att.lunchEndTime);
          
          if (!isNaN(lunchStartDate.getTime()) && !isNaN(lunchEndDate.getTime())) {
            const lunchMs = lunchEndDate.getTime() - lunchStartDate.getTime();
            ms -= lunchMs;
          } else {
            console.error('Invalid lunch time values:', { 
              lunchStartTime: att.lunchStartTime, 
              lunchEndTime: att.lunchEndTime 
            });
          }
        }
        
        // Ensure we don't get negative hours
        if (ms < 0) {
          console.error('Negative time difference calculated:', { ms, startTime: att.startTime, endTime: att.endTime });
          att.totalHours = 0;
        } else {
          att.totalHours = ms / (1000 * 60 * 60);
          // Round to 2 decimal places
          att.totalHours = Math.round(att.totalHours * 100) / 100;
        }
      }
    } catch (error) {
      console.error('Error calculating total hours:', error);
      att.totalHours = 0;
    }
  }
  
  await att.save();
  // Update Excel file: one worksheet per user
  const user = await User.findById(req.user.id);
  await updateExcelPerUserSheet(user, att, type, lat, lng);
  res.json({ message: 'Attendance updated' });
});

// Get my attendance for today
app.get('/api/attendance', auth, async (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  const att = await Attendance.findOne({ userId: req.user.id, date });
  res.json(att);
});

// Get current attendance status for session restoration
app.get('/api/attendance/status', auth, async (req, res) => {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const att = await Attendance.findOne({ userId: req.user.id, date });
    
    if (!att) {
      return res.json({ currentSession: null });
    }
    
    // Determine current session status
    let currentSession = null;
    
    if (att.startTime && !att.endTime) {
      // Work started but not ended
      if (att.lunchStartTime && !att.lunchEndTime) {
        // Currently on lunch break
        currentSession = {
          type: 'lunch_start',
          time: att.lunchStartTime,
          startTime: att.startTime
        };
      } else {
        // Currently working
        currentSession = {
          type: 'start',
          time: att.startTime
        };
      }
    }
    
    res.json({ currentSession });
  } catch (err) {
    console.error('Error getting attendance status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: get all users' progress
app.get('/api/admin/attendance', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  const date = new Date().toISOString().slice(0, 10);
  const atts = await Attendance.find({ date }).populate('userId', 'employeeId name');
  res.json(atts);
});

// Admin: add user (with file upload)
app.post('/api/admin/add-user', auth, upload.fields([
  { name: 'profilePic', maxCount: 1 },
  { name: 'idDocs', maxCount: 5 }
]), async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  try {
    const { employeeId, password, name, isAdmin, email, phone, address, location } = req.body;
    const existing = await User.findOne({ employeeId });
    if (existing) return res.status(400).json({ message: 'Employee ID already exists' });
    const hashed = await bcrypt.hash(password, 10);
    let profilePic = '';
    let idDocs = [];
    const folderName = `/attendence_manager/${employeeId}`;
    if (req.files['profilePic']) {
      try {
        profilePic = await uploadToImageKit(
          req.files['profilePic'][0].path,
          req.files['profilePic'][0].originalname,
          folderName
        );
        console.log('ProfilePic uploaded to ImageKit:', profilePic);
      } catch (err) {
        console.error('Error uploading profilePic to ImageKit:', err);
      }
    }
    if (req.files['idDocs']) {
      for (const file of req.files['idDocs']) {
        try {
          const url = await uploadToImageKit(
            file.path,
            file.originalname,
            folderName
          );
          idDocs.push(url);
          console.log('ID Doc uploaded to ImageKit:', url);
        } catch (err) {
          console.error('Error uploading ID Doc to ImageKit:', err);
        }
      }
    }
    const user = new User({ employeeId, password: hashed, name, isAdmin, email, phone, address, profilePic, idDocs, location: location || null });
    await user.save();
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: get all users
app.get('/api/admin/users', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  const users = await User.find({}, 'employeeId name isAdmin email phone address profilePic idDocs location').populate('location');
  res.json(users);
});

// Admin: Get all locations
app.get('/api/admin/locations', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  try {
    const locations = await Location.find({});
    res.json(locations);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Add a new location
app.post('/api/admin/add-location', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Location name is required' });
    const existing = await Location.findOne({ name });
    if (existing) return res.status(400).json({ message: 'Location already exists' });
    const location = new Location({ name });
    await location.save();
    res.status(201).json(location);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Delete a location
app.delete('/api/admin/delete-location/:id', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  try {
    const { id } = req.params;

    // Remove the location
    const location = await Location.findByIdAndDelete(id);
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }

    // Unset this location from all users who have it
    await User.updateMany({ location: id }, { $unset: { location: 1 } });

    res.json({ message: 'Location deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});
// Admin: Get all job posts
app.get('/api/admin/jobPost', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  try {
    const jobPosts = await JobPost.find({});
    res.json(jobPosts);
  } catch (err) {
     console.error('Error fetching job posts:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Add a new Job Post
app.post('/api/admin/add-jobPost', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'JobPost name is required' });

    const existing = await JobPost.findOne({ name });
    if (existing) return res.status(400).json({ message: 'JobPost already exists' });

    const jobPost = new JobPost({ name });
    await jobPost.save(); // 🔥 Error likely occurs here
    res.status(201).json(jobPost);
  } catch (err) {
    console.error("Error adding job post:", err); // 👈 Add this
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Delete a Job Post
app.delete('/api/admin/delete-jobPost/:id', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  try {
    const { id } = req.params;

    const jobPost = await JobPost.findByIdAndDelete(id);
    if (!jobPost) {
      return res.status(404).json({ message: 'JobPost not found' });
    }

    await User.updateMany({ jobPost: id }, { $unset: { jobPost: 1 } });

    res.json({ message: 'JobPost deleted successfully' }); 
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});


// Admin: get all attendance for a user by employeeId
app.get('/api/admin/user-attendance/:employeeId', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  const user = await User.findOne({ employeeId: req.params.employeeId });
  if (!user) return res.status(404).json({ message: 'User not found' });
  const records = await Attendance.find({ userId: user._id }).sort({ date: -1 });
  res.json(records);
});

// Admin: edit user (name, isAdmin, employeeId, password, profilePic, idDocs) by employeeId
app.put('/api/admin/edit-user/:employeeId', auth, upload.fields([
  { name: 'profilePic', maxCount: 1 },
  { name: 'idDocs', maxCount: 5 }
]), async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  const { name, isAdmin, employeeId: newEmployeeId, password, email, phone, address, location } = req.body;
  const update = {};
  if (name !== undefined) update.name = name;
  if (isAdmin !== undefined) update.isAdmin = isAdmin;
  if (newEmployeeId !== undefined) update.employeeId = newEmployeeId;
  if (email !== undefined) update.email = email;
  if (phone !== undefined) update.phone = phone;
  if (address !== undefined) update.address = address;
  if (location !== undefined) update.location = location;
  if (password) {
    update.password = await bcrypt.hash(password, 10);
  }
  // Handle new profilePic and idDocs
  const folderName = `/attendence_manager/${req.params.employeeId}`;
  if (req.files && req.files['profilePic']) {
    try {
      update.profilePic = await uploadToImageKit(
        req.files['profilePic'][0].path,
        req.files['profilePic'][0].originalname,
        folderName
      );
      console.log('ProfilePic uploaded to ImageKit (edit):', update.profilePic);
    } catch (err) {
      console.error('Error uploading profilePic to ImageKit (edit):', err);
    }
  }
  if (req.files && req.files['idDocs']) {
    update.idDocs = [];
    for (const file of req.files['idDocs']) {
      try {
        const url = await uploadToImageKit(
          file.path,
          file.originalname,
          folderName
        );
        update.idDocs.push(url);
        console.log('ID Doc uploaded to ImageKit (edit):', url);
      } catch (err) {
        console.error('Error uploading ID Doc to ImageKit (edit):', err);
      }
    }
  }
  const user = await User.findOneAndUpdate(
    { employeeId: req.params.employeeId },
    update,
    { new: true }
  );
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ message: 'User updated', user });
});

// Admin: delete user by employeeId
app.delete('/api/admin/delete-user/:employeeId', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  const user = await User.findOneAndDelete({ employeeId: req.params.employeeId });
  if (!user) return res.status(404).json({ message: 'User not found' });
  await Attendance.deleteMany({ userId: user._id });
  res.json({ message: 'User deleted' });
});

// Admin: get next available employee ID
app.get('/api/admin/next-employee-id', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  const users = await User.find({}, 'employeeId');
  // Extract numeric IDs only
  const numbers = users
    .map(u => parseInt(u.employeeId, 10))
    .filter(n => !isNaN(n));
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  const next = (max + 1).toString().padStart(4, '0');
  res.json({ nextEmployeeId: next });
});

// Admin: Edit attendance record by its ID
app.put('/api/admin/attendance/record/:id', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  try {
    const { id } = req.params;
    const { date, startTime, lunchStartTime, lunchEndTime, endTime } = req.body;

    const record = await Attendance.findById(id);
    if (!record) return res.status(404).json({ message: 'Record not found' });

    // Update fields
    record.date = date || record.date;
    record.startTime = startTime || null;
    record.lunchStartTime = lunchStartTime || null;
    record.lunchEndTime = lunchEndTime || null;
    record.endTime = endTime || null;

    // Recalculate total hours with proper validation
    if (record.startTime && record.endTime) {
      try {
        // Validate and parse dates
        const startDate = new Date(record.startTime);
        const endDate = new Date(record.endTime);
        
        // Check if dates are valid
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          console.error('Invalid date values in admin update:', { 
            startTime: record.startTime, 
            endTime: record.endTime 
          });
          record.totalHours = 0;
        } else {
          let ms = endDate.getTime() - startDate.getTime();
          
          // Validate lunch times if they exist
          if (record.lunchStartTime && record.lunchEndTime) {
            const lunchStartDate = new Date(record.lunchStartTime);
            const lunchEndDate = new Date(record.lunchEndTime);
            
            if (!isNaN(lunchStartDate.getTime()) && !isNaN(lunchEndDate.getTime())) {
              const lunchMs = lunchEndDate.getTime() - lunchStartDate.getTime();
              ms -= lunchMs;
            } else {
              console.error('Invalid lunch time values in admin update:', { 
                lunchStartTime: record.lunchStartTime, 
                lunchEndTime: record.lunchEndTime 
              });
            }
          }
          
          // Ensure we don't get negative hours
          if (ms < 0) {
            console.error('Negative time difference calculated in admin update:', { 
              ms, 
              startTime: record.startTime, 
              endTime: record.endTime 
            });
            record.totalHours = 0;
          } else {
            record.totalHours = ms / (1000 * 60 * 60);
            // Round to 2 decimal places
            record.totalHours = Math.round(record.totalHours * 100) / 100;
          }
        }
      } catch (error) {
        console.error('Error calculating total hours in admin update:', error);
        record.totalHours = 0;
      }
    } else {
      record.totalHours = 0;
    }
    
    await record.save();
    
    const user = await User.findById(record.userId);
    await updateExcelRow(user, record);

    res.json({ message: 'Record updated', record });
  } catch (err) {
    console.error('Error updating attendance record:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Clean up invalid attendance records (fix negative hours)
app.post('/api/admin/attendance/cleanup', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  try {
    // Find all attendance records with invalid total hours
    const invalidRecords = await Attendance.find({
      $or: [
        { totalHours: { $lt: 0 } },           // Negative hours
        { totalHours: { $gt: 1000 } },        // Unrealistic high hours
        { totalHours: { $type: 'string' } },  // String values
        { totalHours: null }                  // Null values
      ]
    });

    let fixedCount = 0;
    let errors = [];

    for (const record of invalidRecords) {
      try {
        // Recalculate total hours with validation
        if (record.startTime && record.endTime) {
          const startDate = new Date(record.startTime);
          const endDate = new Date(record.endTime);
          
          if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
            let ms = endDate.getTime() - startDate.getTime();
            
            if (record.lunchStartTime && record.lunchEndTime) {
              const lunchStartDate = new Date(record.lunchStartTime);
              const lunchEndDate = new Date(record.lunchEndTime);
              
              if (!isNaN(lunchStartDate.getTime()) && !isNaN(lunchEndDate.getTime())) {
                const lunchMs = lunchEndDate.getTime() - lunchStartDate.getTime();
                ms -= lunchMs;
              }
            }
            
            if (ms >= 0) {
              record.totalHours = Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
            } else {
              record.totalHours = 0;
            }
          } else {
            record.totalHours = 0;
          }
        } else {
          record.totalHours = 0;
        }
        
        await record.save();
        fixedCount++;
      } catch (error) {
        errors.push(`Record ${record._id}: ${error.message}`);
      }
    }

    res.json({ 
      message: `Cleanup completed. Fixed ${fixedCount} records.`,
      fixedCount,
      totalInvalid: invalidRecords.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('Error during attendance cleanup:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Get attendance cleanup status (check how many invalid records exist)
app.get('/api/admin/attendance/cleanup-status', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  try {
    const invalidCount = await Attendance.countDocuments({
      $or: [
        { totalHours: { $lt: 0 } },
        { totalHours: { $gt: 1000 } },
        { totalHours: { $type: 'string' } },
        { totalHours: null }
      ]
    });

    const totalRecords = await Attendance.countDocuments();
    
    res.json({ 
      invalidRecords: invalidCount,
      totalRecords,
      needsCleanup: invalidCount > 0
    });
  } catch (err) {
    console.error('Error checking cleanup status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Test endpoint to verify backend is working
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Backend is working!', 
    timestamp: new Date().toISOString(),
    models: {
      Report: !!Report,
      User: !!User,
      Attendance: !!Attendance
    }
  });
});

// User: Submit a report
app.post('/api/reports', auth, upload.array('pictures', 5), async (req, res) => {
  try {
    console.log('🔍 Report submission request received:', {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      files: req.files ? req.files.length : 0,
      user: req.user,
      userId: req.user.id,
      contentType: req.headers['content-type']
    });

    const { type, date, time, message, location } = req.body;
    
    console.log('🔍 Parsed form data:', { type, date, time, message, location });
    
    if (!type || !date || !time || !message) {
      console.log('❌ Missing required fields:', { type, date, time, message });
      return res.status(400).json({ message: 'Type, date, time, and message are required' });
    }

    // Validate user ID
    if (!req.user.id) {
      console.error('❌ No user ID found in request:', req.user);
      return res.status(400).json({ message: 'Invalid user token' });
    }

    console.log('✅ User validation passed, proceeding with report creation...');

    // Upload pictures to ImageKit if any
    const pictureUrls = [];
    if (req.files && req.files.length > 0) {
      console.log(`📸 Processing ${req.files.length} uploaded files`);
      const folderName = `/attendence_manager/reports/${req.user.id}`;
      for (const file of req.files) {
        try {
          console.log('📁 Uploading file:', file.originalname, 'Size:', file.size);
          const url = await uploadToImageKit(
            file.path,
            file.originalname,
            folderName
          );
          if (url) {
            pictureUrls.push(url);
            console.log('✅ File uploaded successfully:', url);
          } else {
            console.log('❌ File upload failed for:', file.originalname);
          }
        } catch (err) {
          console.error('❌ Error uploading picture to ImageKit:', err);
        }
      }
    } else {
      console.log('📸 No files to upload');
    }

    console.log('📝 Creating report with data:', {
      userId: req.user.id,
      type,
      date,
      time,
      message: message.substring(0, 50) + '...',
      location,
      picturesCount: pictureUrls.length
    });

    // Validate that the Report model exists
    if (!Report) {
      console.error('❌ Report model not found!');
      return res.status(500).json({ message: 'Report model not available' });
    }

    const report = new Report({
      userId: req.user.id,
      type,
      date,
      time,
      message,
      location,
      pictures: pictureUrls,
    });

    console.log('💾 Saving report to database...');
    await report.save();
    console.log('✅ Report saved successfully with ID:', report._id);
    
    res.status(201).json({ 
      message: 'Report submitted successfully', 
      report: {
        id: report._id,
        type: report.type,
        date: report.date,
        time: report.time,
        message: report.message,
        location: report.location,
        picturesCount: report.pictures.length
      }
    });
    
  } catch (err) {
    console.error('❌ Error submitting report:', err);
    console.error('❌ Error name:', err.name);
    console.error('❌ Error message:', err.message);
    console.error('❌ Error stack:', err.stack);
    console.error('❌ Request body:', req.body);
    console.error('❌ User object:', req.user);
    console.error('❌ Files:', req.files);
    
    // Send more specific error messages
    let errorMessage = 'Server error';
    if (err.name === 'ValidationError') {
      errorMessage = 'Validation error: ' + err.message;
    } else if (err.name === 'MongoError') {
      errorMessage = 'Database error: ' + err.message;
    }
    
    res.status(500).json({ 
      message: errorMessage, 
      error: err.message,
      details: {
        name: err.name,
        stack: err.stack
      }
    });
  }
});

// Admin: Get all reports with filters
app.get('/api/admin/reports', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  try {
    const { 
      startDate, 
      endDate, 
      type, 
      userId,
      page = 1,
      limit = 20
    } = req.query;

    const filter = {};
    
    // Date range filter
    if (startDate && endDate) {
      filter.date = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      filter.date = { $gte: startDate };
    } else if (endDate) {
      filter.date = { $lte: endDate };
    }

    // Type filter
    if (type && type !== 'all') {
      filter.type = type;
    }

    // User filter
    if (userId) {
      const user = await User.findOne({ employeeId: userId });
      if (user) {
        filter.userId = user._id;
      }
    }

    const skip = (page - 1) * limit;
    
    const reports = await Report.find(filter)
      .populate('userId', 'employeeId name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Report.countDocuments(filter);

    res.json({
      reports,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Error fetching reports:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin: Get report count for notification
app.get('/api/admin/reports/count', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Forbidden' });
  try {
    const problemCount = await Report.countDocuments({ type: 'problem' });
    res.json({ problemCount });
  } catch (err) {
    console.error('Error fetching report count:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Live Data Endpoints
// Get live guard statuses and statistics
app.get('/api/live/status', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    
    // Get all users (guards)
    const users = await User.find({}).populate('location');
    
    // Get today's attendance records
    const todayAttendance = await Attendance.find({ date: today });
    
    // Debug: Log all attendance records for today
    console.log('🔍 Debug: Today\'s attendance records:', todayAttendance.map(att => ({
      userId: att.userId,
      startTime: att.startTime,
      endTime: att.endTime,
      lunchStartTime: att.lunchStartTime,
      lunchEndTime: att.lunchEndTime,
      date: att.date
    })));
    
    // Get today's reports
    const todayReports = await Report.find({ date: today });
    
    // Calculate live statistics using correct field names
    const activeGuards = todayAttendance.filter(att => 
      att.startTime && !att.endTime
    ).length;
    
    const totalPosts = await Location.countDocuments();
    const incidentsToday = todayReports.filter(report => report.type === 'problem').length;
    const checkInsToday = todayAttendance.filter(att => att.startTime).length;
    
    // Get guard statuses with real data using correct field names
    const guardStatuses = users.map(user => {
      const userAttendance = todayAttendance.find(att => att.userId.toString() === user._id.toString());
      
      let status = 'offline';
      let lastSeen = null;
      
      if (userAttendance) {
        if (userAttendance.startTime && !userAttendance.endTime) {
          // Work started but not ended
          if (userAttendance.lunchStartTime && !userAttendance.lunchEndTime) {
            status = 'break';
            lastSeen = userAttendance.lunchStartTime;
          } else {
            status = 'active';
            lastSeen = userAttendance.startTime;
          }
        } else if (userAttendance.endTime) {
          // Work ended
          status = 'offline';
          lastSeen = userAttendance.endTime;
        } else if (userAttendance.startTime) {
          // Only start time recorded (should be active)
          status = 'active';
          lastSeen = userAttendance.startTime;
        }
      }
      
      // Debug logging for specific user
      if (user.name === 'Test User2') {
        console.log('🔍 Debug Test User2 status:', {
          userId: user._id,
          userAttendance: userAttendance ? {
            startTime: userAttendance.startTime,
            endTime: userAttendance.endTime,
            lunchStartTime: userAttendance.lunchStartTime,
            lunchEndTime: userAttendance.lunchEndTime
          } : null,
          calculatedStatus: status,
          lastSeen
        });
      }
      
      return {
        id: user._id,
        name: user.name,
        post: user.location?.name || 'Unassigned',
        status,
        lastSeen,
        employeeId: user.employeeId
      };
    });
    
    // Debug: Log all guard statuses
    console.log('🔍 Debug: All guard statuses:', guardStatuses.map(guard => ({
      name: guard.name,
      status: guard.status,
      lastSeen: guard.lastSeen,
      post: guard.post
    })));
    
    // Get recent activity using correct field names
    const recentActivity = todayAttendance
      .filter(att => att.startTime || att.lunchStartTime || att.lunchEndTime || att.endTime)
      .slice(0, 10)
      .map(att => {
        const user = users.find(u => u._id.toString() === att.userId.toString());
        let type = 'checkin';
        let time = att.startTime;
        
        if (att.lunchStartTime && !att.lunchEndTime) {
          type = 'lunch_start';
          time = att.lunchStartTime;
        } else if (att.lunchEndTime) {
          type = 'lunch_end';
          time = att.lunchEndTime;
        } else if (att.endTime) {
          type = 'checkout';
          time = att.endTime;
        }
        
        return {
          id: att._id,
          guard: user?.name || 'Unknown',
          post: user?.location?.name || 'Unknown',
          type,
          time,
          timeAgo: formatTimeAgo(new Date(time))
        };
      })
      .sort((a, b) => new Date(b.time) - new Date(a.time));
    
    res.json({
      liveData: {
        activeGuards,
        totalPosts,
        incidentsToday,
        checkInsToday,
        lastUpdate: new Date()
      },
      guardStatuses,
      recentActivity
    });
    
  } catch (err) {
    console.error('Error fetching live status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to format time ago
function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

// Error handling for invalid routes
app.use((req, res) => {
  res.status(404).json({ message: 'Not Found' });
});


const PORT = process.env.PORT || 5001;  
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));