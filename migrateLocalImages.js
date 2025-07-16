import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import cloudinary from 'cloudinary';

dotenv.config();

// Cloudinary config (same as in index.js)
cloudinary.v2.config({
  cloud_name: 'ddcd8t9pc',
  api_key: '472572833492893',
  api_secret: '0ToFJa9wH3zg3lI4W3fAWtG8lgw',
});

// Helper to upload a file to Cloudinary
async function uploadToCloudinary(filePath) {
  return new Promise((resolve, reject) => {
    cloudinary.v2.uploader.upload(filePath, { folder: 'attendence_manager' }, (err, result) => {
      if (err) return reject(err);
      resolve(result.secure_url);
    });
  });
}

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const userSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: String,
  isAdmin: { type: Boolean, default: false },
  email: String,
  phone: String,
  address: String,
  profilePic: String,
  idDocs: [String],
});
const User = mongoose.model('User', userSchema);

async function migrate() {
  const users = await User.find({});
  for (const user of users) {
    let updated = false;

    // Migrate profilePic
    if (user.profilePic && user.profilePic.startsWith('/uploads/')) {
      const localPath = path.join(process.cwd(), '..', user.profilePic);
      if (fs.existsSync(localPath)) {
        const url = await uploadToCloudinary(localPath);
        user.profilePic = url;
        updated = true;
        console.log(`Migrated profilePic for ${user.employeeId}`);
      }
    }

    // Migrate idDocs
    if (user.idDocs && user.idDocs.length > 0) {
      let newDocs = [];
      for (const doc of user.idDocs) {
        if (doc.startsWith('/uploads/')) {
          const localPath = path.join(process.cwd(), '..', doc);
          if (fs.existsSync(localPath)) {
            const url = await uploadToCloudinary(localPath);
            newDocs.push(url);
            updated = true;
            console.log(`Migrated idDoc for ${user.employeeId}`);
          }
        } else {
          newDocs.push(doc);
        }
      }
      user.idDocs = newDocs;
    }

    if (updated) {
      await user.save();
      console.log(`Updated user ${user.employeeId}`);
    }
  }
  console.log('Migration complete!');
  process.exit();
}

migrate(); 