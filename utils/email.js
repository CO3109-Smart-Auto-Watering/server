const nodemailer = require('nodemailer');

/**
 * Gửi email thông qua cấu hình nodemailer
 * @param {Object} options - Các tùy chọn email
 */
const sendEmail = async options => {
  // 1) Create a transporter
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD
    }
  });

  // 2) Define the email options
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'Học viện Công nghệ <noreply@hcmut.edu.vn>',
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html
  };

  // 3) Send the email
  await transporter.sendMail(mailOptions);
};

/**
 * Gửi email đặt lại mật khẩu
 * @param {String} email - Email người dùng
 * @param {String} resetUrl - URL đặt lại mật khẩu
 * @param {String} username - Tên người dùng
 * @returns {Boolean} - Kết quả gửi email
 */
const sendPasswordResetEmail = async (email, resetUrl, username) => {
  try {
    const subject = 'Đặt lại mật khẩu của bạn (có hiệu lực trong 15 phút)';
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #4975d1;">Đặt lại mật khẩu</h2>
        </div>
        
        <p>Xin chào ${username || 'bạn'},</p>
        
        <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>
        
        <p>Vui lòng nhấp vào nút dưới đây để đặt lại mật khẩu. Lưu ý rằng liên kết này chỉ có hiệu lực trong <strong>15 phút</strong>.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #4975d1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Đặt lại mật khẩu</a>
        </div>
        
        <p>Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này hoặc liên hệ với bộ phận hỗ trợ của chúng tôi nếu bạn có bất kỳ câu hỏi nào.</p>
        
        <p>Nếu nút trên không hoạt động, bạn có thể sao chép và dán liên kết sau vào trình duyệt của mình:</p>
        
        <p style="word-break: break-all; background-color: #f5f5f5; padding: 10px; border-radius: 4px;">${resetUrl}</p>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666; text-align: center;">
          <p>Email này được gửi tự động, vui lòng không trả lời.</p>
        </div>
      </div>
    `;
    
    const message = `
      Xin chào ${username || 'bạn'},
      
      Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.
      
      Vui lòng sử dụng liên kết sau để đặt lại mật khẩu của bạn: ${resetUrl}
      
      Liên kết này có hiệu lực trong 15 phút.
      
      Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.
    `;
    
    await sendEmail({
      email,
      subject,
      message,
      html
    });
    
    return true;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return false;
  }
};

module.exports = {
  sendEmail,
  sendPasswordResetEmail
};