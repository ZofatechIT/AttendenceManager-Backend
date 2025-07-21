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
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/your_imagekit_id', // Fallback
});

// Helper to upload a file to ImageKit
async function uploadToImageKit(filePath, fileName, folder = '/attendence_manager') {
  // Bypassing ImageKit upload for now to prevent crashes
  if (!process.env.IMAGEKIT_URL_ENDPOINT) {
    console.log(`ImageKit upload skipped for ${fileName} because URL endpoint is not configured.`);
    return `https://via.placeholder.com/150/0000FF/808080?Text=ImageKit+Bypassed`;
  }
  const fileBuffer = fs.readFileSync(filePath);
  const result = await imagekit.upload({
    file: fileBuffer,
    fileName: fileName,
    folder: folder,
  });
  return result.url;
}

const app = express();

// CORS setup for frontend
app.use(cors({
  origin: [
    'https://attendence-manager-frontend.vercel.app',
    'http://localhost:5173'
  ],
  credentials: true
}));
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('MongoDB connected');
}).catch((err) => {
  console.error('MongoDB connection error:', err);
});

// Set up multer for file uploads
const uploadDir = path.join(process.cwd(), '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
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
const Location = mongoose.model('Location', locationSchema);

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

// Login API
app.post('/api/login', async (req, res) => {
  try {
    const { employeeId, password } = req.body;
    const user = await User.findOne({ employeeId });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, process.env.JWT_SECRET, { expiresIn: '1d' });
    const userWithLocation = await User.findById(user._id).populate('location');
    res.json({ token, user: userWithLocation });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Middleware to verify JWT
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
}

// Record attendance event
app.post('/api/attendance', auth, async (req, res) => {
  const { type, time, lat, lng } = req.body;
  const date = new Date().toISOString().slice(0, 10);
  let att = await Attendance.findOne({ userId: req.user.id, date });
  if (!att) att = new Attendance({ userId: req.user.id, date, locations: [] });
  if (type === 'start') att.startTime = time;
  if (type === 'lunchStart') att.lunchStartTime = time;
  if (type === 'lunchEnd') att.lunchEndTime = time;
  if (type === 'end') att.endTime = time;
  if (lat && lng) att.locations.push({ time, lat, lng });
  if (type === 'end' && att.startTime && att.endTime) {
    let ms = new Date(att.endTime) - new Date(att.startTime);
    if (att.lunchStartTime && att.lunchEndTime) {
      ms -= new Date(att.lunchEndTime) - new Date(att.lunchStartTime);
    }
    att.totalHours = ms / (1000 * 60 * 60);
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

    // Recalculate total hours
    if (record.startTime && record.endTime) {
      let ms = new Date(record.endTime) - new Date(record.startTime);
      if (record.lunchStartTime && record.lunchEndTime) {
        ms -= new Date(record.lunchEndTime) - new Date(record.lunchStartTime);
      }
      record.totalHours = ms / (1000 * 60 * 60);
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

app.get('/', (req, res) => {
  res.send('Attendance Manager Backend Running');
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));