const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const app = express();
const port = 8081;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const processedUrls = new Map();

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

async function bypassAndGetData(targetUrl) {
  console.log(`Đang xử lý URL: ${targetUrl}`);

  const axiosInstance = axios.create({
    maxRedirects: 5,
    validateStatus: status => status < 500,
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });

  const initialResponse = await axiosInstance.get(targetUrl);

  const cookies = initialResponse.headers['set-cookie'];
  let cookieHeader = '';
  if (cookies) {
    cookieHeader = cookies.map(cookie => cookie.split(';')[0]).join('; ');
  }

  const html = initialResponse.data;
  if (typeof html === 'string' && html.includes('Click vào đây để đi tiếp')) {
    console.log('Đã phát hiện trang CAPTCHA, đang bypass...');

    const $ = cheerio.load(html);

    const captchaButton = $('a:contains("Click vào đây để đi tiếp")');
    
    if (captchaButton.length > 0 && captchaButton.attr('href')) {
      const captchaUrl = new URL(captchaButton.attr('href'), targetUrl).href;
      console.log('Đã tìm thấy URL CAPTCHA:', captchaUrl);

      const captchaResponse = await axiosInstance.get(captchaUrl, {
        headers: {
          'Cookie': cookieHeader,
          'Referer': targetUrl
        }
      });

      if (captchaResponse.headers['set-cookie']) {
        const newCookies = captchaResponse.headers['set-cookie'];
        cookieHeader = newCookies.map(cookie => cookie.split(';')[0]).join('; ');
      }
    } else {
      console.log('Không tìm thấy nút CAPTCHA, thử tìm form...');
      
      const form = $('form');
      if (form.length > 0) {
        const formAction = new URL(form.attr('action') || '', targetUrl).href;
        console.log('Đã tìm thấy form với action:', formAction);

        const formData = {};
        form.find('input').each((i, el) => {
          const name = $(el).attr('name');
          const value = $(el).attr('value');
          if (name) formData[name] = value || '';
        });
 
        const formResponse = await axiosInstance.post(formAction, formData, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookieHeader,
            'Referer': targetUrl
          }
        });
  
        if (formResponse.headers['set-cookie']) {
          const newCookies = formResponse.headers['set-cookie'];
          cookieHeader = newCookies.map(cookie => cookie.split(';')[0]).join('; ');
        }
      }
    }

    const bypassUrl = targetUrl + (targetUrl.includes('?') ? '&' : '?') + '_captcha=1&verify=1&confirmed=1';
    try {
      const directBypassResponse = await axiosInstance.get(bypassUrl, {
        headers: {
          'Cookie': cookieHeader,
          'Referer': targetUrl
        }
      });

      if (directBypassResponse.headers['set-cookie']) {
        const newCookies = directBypassResponse.headers['set-cookie'];
        cookieHeader = newCookies.map(cookie => cookie.split(';')[0]).join('; ');
      }
    } catch (error) {
      console.log('Phương pháp bypass trực tiếp không thành công, tiếp tục...');
    }
  }

  console.log('Đang truy cập lại URL gốc để lấy nội dung...');
  const finalResponse = await axiosInstance.get(targetUrl, {
    responseType: 'arraybuffer',
    headers: {
      'Cookie': cookieHeader
    }
  });

  const contentType = finalResponse.headers['content-type'] || '';
  if (!contentType.includes('pdf') && !contentType.includes('image')) {
    try {
      const textContent = Buffer.from(finalResponse.data).toString('utf8');
      if (textContent.includes('Click vào đây để đi tiếp')) {
        console.log('Vẫn đang ở trang CAPTCHA, bypass không thành công');
        throw new Error('Không thể bypass CAPTCHA');
      }
    } catch (error) {
      console.log('Không thể chuyển đổi response thành text, giả định là OK');
    }
  }

  return {
    data: finalResponse.data,
    contentType: contentType,
    filename: extractFilename(targetUrl, contentType)
  };
}

function extractFilename(url, contentType) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
 
    const matches = pathname.match(/\/([^\/]+)\.([a-zA-Z0-9]+)(?:\?|$)/);
    if (matches && matches.length >= 3) {
      return `${matches[1]}.${matches[2]}`;
    }
   
    if (contentType.includes('pdf')) {
      return `document-${Date.now()}.pdf`;
    } else if (contentType.includes('image')) {
      const imageExt = contentType.split('/')[1] || 'jpg';
      return `image-${Date.now()}.${imageExt}`;
    }
   
    return `file-${Date.now()}`;
  } catch (error) {
    console.error('Lỗi khi trích xuất tên file:', error);
    return `file-${Date.now()}`;
  }
}

app.get('/api-a', async (req, res) => {
  try {
    let targetUrl = req.query.url;
    
    if (!targetUrl) {
      return res.status(400).send('Thiếu tham số URL');
    }

    while (targetUrl.includes('%')) {
      const decodedUrl = decodeURIComponent(targetUrl);
      if (decodedUrl === targetUrl) break;
      targetUrl = decodedUrl;
    }
  
    if (targetUrl.includes('localhost:8080/api')) {
      const urlMatch = targetUrl.match(/url=(https?%3A%2F%2F[^&]+)/);
      if (urlMatch && urlMatch[1]) {
        targetUrl = decodeURIComponent(urlMatch[1]);
        console.log('Đã phát hiện URL đệ quy, đã sửa thành:', targetUrl);
      } else {
        return res.status(400).send('URL không hợp lệ - đang gọi đệ quy đến chính API');
      }
    }

    if (!targetUrl.startsWith('http')) {
      return res.status(400).send('URL không hợp lệ - phải bắt đầu bằng http hoặc https');
    }
 
    // if (processedUrls.has(targetUrl)) {
    //   console.log('URL đã được xử lý trước đó, trả về kết quả từ cache');
    //   const cachedResult = processedUrls.get(targetUrl);
      
    //   res.setHeader('Content-Type', cachedResult.contentType);
    
    //   if (cachedResult.contentType.includes('pdf') || 
    //       cachedResult.contentType.includes('image') ||
    //       cachedResult.contentType.includes('application/')) {
    //     res.setHeader('Content-Disposition', `inline; filename="${cachedResult.filename}"`);
    //   }
      
    //   return res.send(cachedResult.data);
    // }
 
    const result = await bypassAndGetData(targetUrl);

    processedUrls.set(targetUrl, result);
  
    res.setHeader('Content-Type', result.contentType);
    
    if (result.contentType.includes('pdf') || 
        result.contentType.includes('image') ||
        result.contentType.includes('application/')) {
      res.setHeader('Content-Disposition', `inline; filename="${result.filename}"`);
    }

    return res.send(result.data);
    
  } catch (error) {
    console.error('Lỗi:', error.message);
    res.status(500).send(`<h1>Lỗi khi xử lý request</h1><p>${error.message}</p><p>URL: ${req.query.url}</p>`);
  }
});

app.get('/api-download', async (req, res) => {
  try {
    let targetUrl = req.query.url;
    
    if (!targetUrl) {
      return res.status(400).send('Thiếu tham số URL');
    }

    while (targetUrl.includes('%')) {
      const decodedUrl = decodeURIComponent(targetUrl);
      if (decodedUrl === targetUrl) break;
      targetUrl = decodedUrl;
    }

    if (targetUrl.includes('localhost:8080/api')) {
      const urlMatch = targetUrl.match(/url=(https?%3A%2F%2F[^&]+)/);
      if (urlMatch && urlMatch[1]) {
        targetUrl = decodeURIComponent(urlMatch[1]);
        console.log('Đã phát hiện URL đệ quy, đã sửa thành:', targetUrl);
      } else {
        return res.status(400).send('URL không hợp lệ - đang gọi đệ quy đến chính API');
      }
    }

    if (!targetUrl.startsWith('http')) {
      return res.status(400).send('URL không hợp lệ - phải bắt đầu bằng http hoặc https');
    }

    let result;
    if (processedUrls.has(targetUrl)) {
      console.log('URL đã được xử lý trước đó, trả về kết quả từ cache');
      result = processedUrls.get(targetUrl);
    } else {
      result = await bypassAndGetData(targetUrl);
  
      processedUrls.set(targetUrl, result);
    }

    res.setHeader('Content-Type', result.contentType);
   
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
   
    return res.send(result.data);
    
  } catch (error) {
    console.error('Lỗi:', error.message);
    res.status(500).send(`<h1>Lỗi khi xử lý request</h1><p>${error.message}</p><p>URL: ${req.query.url}</p>`);
  }
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Bypass CAPTCHA cuuduongthancong.com</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 20px;
            line-height: 1.6;
          }
          h1 { color: #2c3e50; margin-bottom: 20px; }
          .form-group { margin-bottom: 15px; }
          label { display: block; margin-bottom: 5px; font-weight: bold; }
          input[type="text"] { 
            width: 100%; 
            padding: 8px; 
            font-size: 16px; 
            border: 1px solid #ddd;
            border-radius: 4px;
          }
          .button-group { margin-top: 15px; }
          button { 
            background: #3498db; 
            color: white; 
            border: none; 
            padding: 10px 15px; 
            cursor: pointer; 
            font-size: 16px;
            border-radius: 4px;
            margin-right: 10px;
          }
          button:hover { background: #2980b9; }
          button.download { background: #27ae60; }
          button.download:hover { background: #219955; }
          .example { 
            background: #f8f9fa; 
            padding: 15px; 
            border-left: 4px solid #3498db; 
            margin: 20px 0;
            border-radius: 0 4px 4px 0;
          }
          code {
            background: #f1f1f1;
            padding: 2px 5px;
            border-radius: 3px;
            font-family: monospace;
            word-break: break-all;
          }
          .error { color: #e74c3c; margin-top: 10px; }
        </style>
      </head>
      <body>
        <h1>Bypass CAPTCHA - cuuduongthancong.com</h1>
        
        <div class="form-group">
          <label for="url">URL cần bypass:</label>
          <input type="text" id="url" placeholder="Nhập URL từ cuuduongthancong.com" 
                 value="https://cuuduongthancong.com/dlf/833816/[ktvm]-kinh-te-vi-mo/nguyen-thi-thuy-vinh/nguyen-ly--c1-tong-quan-ve-kinh-te-hoc-vi-mo.pdf?src=afile&action=hover">
        </div>
        
        <div class="button-group">
          <button onclick="viewContent()">Xem Nội Dung</button>
          <button onclick="downloadContent()" class="download">Tải Xuống</button>
        </div>
        <div id="error" class="error"></div>
        
        <div class="example">
          <p><strong>Cách sử dụng API:</strong></p>
          <p><strong>1. Để xem nội dung:</strong></p>
          <code>http://localhost:8080/api-a?url=URL_CẦN_BYPASS</code>
          
          <p><strong>2. Để tải xuống:</strong></p>
          <code>http://localhost:8080/api-download?url=URL_CẦN_BYPASS</code>
          
          <p><strong>Ví dụ:</strong></p>
          <code>http://localhost:8080/api-a?url=https://cuuduongthancong.com/dlf/833816/[ktvm]-kinh-te-vi-mo/nguyen-thi-thuy-vinh/nguyen-ly--c1-tong-quan-ve-kinh-te-hoc-vi-mo.pdf?src=afile&action=hover</code>
        </div>
        
        <script>
          function validateURL(url) {
            const errorElement = document.getElementById('error');
            
            if (!url) {
              errorElement.textContent = 'Vui lòng nhập URL!';
              return false;
            }
            
            errorElement.textContent = '';
            
            try {
              // Kiểm tra URL hợp lệ
              new URL(url);
              return true;
            } catch (error) {
              errorElement.textContent = 'URL không hợp lệ: ' + error.message;
              return false;
            }
          }
          
          function viewContent() {
            const url = document.getElementById('url').value;
            if (validateURL(url)) {
              window.location.href = '/api-a?url=' + encodeURIComponent(url);
            }
          }
          
          function downloadContent() {
            const url = document.getElementById('url').value;
            if (validateURL(url)) {
              window.location.href = '/api-download?url=' + encodeURIComponent(url);
            }
          }
        </script>
      </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});