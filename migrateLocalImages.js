import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import ImageKit from 'imagekit';

dotenv.config();

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

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

async function uploadToImageKit(filePath, fileName, folder = '/attendence_manager') {
  const fileBuffer = fs.readFileSync(filePath);
  const result = await imagekit.upload({
    file: fileBuffer,
    fileName: fileName,
    folder: folder,
  });
  return result.url;
}

async function migrate() {
  const users = await User.find({});
  for (const user of users) {
    let updated = false;
    const folderName = `/attendence_manager/${user.employeeId}`;

    // Migrate profilePic
    if (user.profilePic && user.profilePic.startsWith('/uploads/')) {
      const localPath = path.join(process.cwd(), '..', user.profilePic);
      if (fs.existsSync(localPath)) {
        const url = await uploadToImageKit(localPath, path.basename(localPath), folderName);
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
            const url = await uploadToImageKit(localPath, path.basename(localPath), folderName);
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