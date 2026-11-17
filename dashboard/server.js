// ============================================================
// PHẦN CỦA PHÁT: Tích hợp Client với Kong Gateway (JWT Auth)
// ============================================================
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Khai báo biến môi trường cho Dashboard
const PORT = process.env.PORT || 3000;
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8000';
const JWT_TOKEN = process.env.JWT_TOKEN || 'DÁN_TOKEN_CỦA_NHÓM_VÀO_ĐÂY'; 

// Tạo một instance Axios chuyên dụng để luôn tự động gắn Token vào Header
const apiClient = axios.create({
  baseURL: GATEWAY_URL,
  timeout: 5000
});

apiClient.interceptors.request.use((config) => {
  config.headers['Authorization'] = `Bearer ${JWT_TOKEN}`;
  config.headers['X-Client-Id'] = 'Dashboard-Web';
  config.headers['X-Correlation-Id'] = `dash-${Date.now()}`;
  return config;
}, (error) => {
  return Promise.reject(error);
});

// Phục vụ file tĩnh (nếu có thư mục public chứa HTML/CSS/JS)
// app.use(express.static(path.join(__dirname, 'public')));

// API Frontend gọi để lấy dữ liệu vẽ biểu đồ
app.get('/api/summary', async (req, res) => {
  try {
    // Gọi qua Kong Gateway (đã tự động đính kèm JWT ở trên)
    const response = await apiClient.get('/api/v1/dashboard/summary');
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('[Dashboard] Loi khi goi Gateway:', error.message);
    const status = error.response ? error.response.status : 500;
    res.status(status).json({ 
      success: false, 
      message: 'Khong the ket noi toi he thong loi hoac sai Token',
      details: error.response?.data || error.message
    });
  }
});

// Endpoint kiểm tra sức khỏe của riêng Dashboard
app.get('/health', (req, res) => {
  res.json({ status: 'UP', service: 'dashboard-ui' });
});

app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`[Dashboard] Dang chay tai cong ${PORT}`);
  console.log(`[Dashboard] Gateway URL: ${GATEWAY_URL}`);
  console.log(`=========================================`);
});