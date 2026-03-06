const path = require('path');
const multer = require('multer');
const fs = require('fs');

const root = path.join(process.cwd(), 'uploads', 'incapacidades');
fs.mkdirSync(root, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, root),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${ts}_${safe}`);
  }
});

const fileFilter = (_req, file, cb) => {
  // pdf|jpg|png
  const ok = /pdf|jpeg|jpg|png/.test(file.mimetype);
  cb(ok ? null : new Error('Tipo de archivo no permitido'), ok);
};

const uploadIncapacidad = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

module.exports = { uploadIncapacidad, rootUploadsIncap: root };
