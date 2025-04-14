const { createCanvas, registerFont } = require('canvas');
const { Chart } = require('chart.js/auto');
const fs = require('fs');
const path = require('path');

// Đường dẫn đến font
const FONT_REGULAR = path.join(__dirname, "../assets/fonts/static/Roboto-Regular.ttf");

// Đăng ký font để hiển thị tiếng Việt đúng
registerFont(FONT_REGULAR, { family: 'Roboto' });

/**
 * Tạo biểu đồ đường cho dữ liệu cảm biến
 * @param {Array} data - Dữ liệu cảm biến theo ngày
 * @param {String} type - Loại dữ liệu ('temperature', 'humidity', 'soilMoisture')
 * @returns {Buffer} - Buffer chứa hình ảnh biểu đồ
 */
exports.generateSensorChart = async (data, type) => {
  try {
    // Ghi log để debug
    console.log(`Generating chart for ${type} with ${data.length} data points`);
    
    // Tạo canvas với kích thước phù hợp
    const width = 700;
    const height = 350;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Cấu hình tiêu đề và màu sắc dựa vào loại dữ liệu
    let title, color, label, yAxisLabel;
    
    switch(type) {
      case 'temperature':
        title = 'Biểu Đồ Nhiệt Độ';
        color = 'rgb(255, 99, 132)';
        label = 'Nhiệt độ (°C)';
        yAxisLabel = 'Nhiệt độ (°C)';
        break;
      case 'humidity':
        title = 'Biểu Đồ Độ Ẩm Không Khí';
        color = 'rgb(54, 162, 235)';
        label = 'Độ ẩm không khí (%)';
        yAxisLabel = 'Độ ẩm (%)';
        break;
      case 'soilMoisture':
        title = 'Biểu Đồ Độ Ẩm Đất';
        color = 'rgb(75, 192, 192)';
        label = 'Độ ẩm đất (%)';
        yAxisLabel = 'Độ ẩm (%)';
        break;
      default:
        title = 'Biểu Đồ Dữ Liệu Cảm Biến';
        color = 'rgb(153, 102, 255)';
        label = 'Giá trị';
        yAxisLabel = 'Giá trị';
    }
    
    // Chuẩn bị dữ liệu cho biểu đồ
    const labels = data.map(item => formatDate(item.date));
    const values = data.map(item => item[type] || 0);
    
    console.log('Chart data:', { labels, values });
    
    // Tạo biểu đồ sử dụng Chart.js
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: label,
          data: values,
          borderColor: color,
          backgroundColor: color.replace('rgb', 'rgba').replace(')', ', 0.2)'),
          borderWidth: 2,
          tension: 0.3,
          fill: true,
          pointRadius: 4
        }]
      },
      options: {
        responsive: false,
        animation: false, // Disable animation for server-side rendering
        plugins: {
          title: {
            display: true,
            text: title,
            font: {
              size: 18,
              family: 'Roboto'
            },
            padding: 20
          },
          legend: {
            position: 'bottom',
            labels: {
              font: {
                family: 'Roboto'
              }
            }
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Ngày',
              font: {
                family: 'Roboto'
              }
            },
            ticks: {
              font: {
                family: 'Roboto'
              }
            }
          },
          y: {
            title: {
              display: true,
              text: yAxisLabel,
              font: {
                family: 'Roboto'
              }
            },
            beginAtZero: true,
            ticks: {
              font: {
                family: 'Roboto'
              }
            }
          }
        }
      }
    });
    
    // Render chart vào canvas
    chart.render(); // Thêm dòng này để đảm bảo biểu đồ được render
    
    // Debug: Lưu biểu đồ vào file để kiểm tra
    const debugDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    
    const debugFilePath = path.join(debugDir, `chart-${type}-${Date.now()}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(debugFilePath, buffer);
    
    console.log(`Chart saved for debugging at: ${debugFilePath}`);
    
    // Clean up
    chart.destroy();
    
    // Trả về buffer PNG
    return buffer;
  } catch (error) {
    console.error('Error generating chart:', error);
    throw error;
  }
};

/**
 * Tạo biểu đồ cột cho thống kê tưới nước
 * @param {Array} pumpEvents - Dữ liệu các lần tưới nước
 * @returns {Buffer} - Buffer chứa hình ảnh biểu đồ
 */
exports.generateWateringChart = async (pumpEvents) => {
  try {
    // Nhóm dữ liệu theo ngày
    const eventsByDay = {};
    
    pumpEvents.forEach(event => {
      const date = new Date(event.timestamp).toISOString().split('T')[0];
      if (!eventsByDay[date]) {
        eventsByDay[date] = {
          count: 0,
          totalWater: 0,
          totalDuration: 0
        };
      }
      
      eventsByDay[date].count += 1;
      eventsByDay[date].totalWater += event.waterUsed;
      eventsByDay[date].totalDuration += event.duration;
    });
    
    // Chuẩn bị dữ liệu cho biểu đồ
    const dates = Object.keys(eventsByDay).sort();
    const waterData = dates.map(date => eventsByDay[date].totalWater);
    const durationData = dates.map(date => eventsByDay[date].totalDuration);
    
    // Tạo canvas
    const width = 700;
    const height = 350;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Tạo biểu đồ
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: dates.map(date => formatDate(date)),
        datasets: [
          {
            label: 'Lượng nước (lít)',
            data: waterData,
            backgroundColor: 'rgba(54, 162, 235, 0.7)',
            borderColor: 'rgb(54, 162, 235)',
            borderWidth: 1
          },
          {
            label: 'Thời gian tưới (phút)',
            data: durationData,
            backgroundColor: 'rgba(255, 99, 132, 0.7)',
            borderColor: 'rgb(255, 99, 132)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          title: {
            display: true,
            text: 'Thống Kê Tưới Nước Theo Ngày',
            font: {
              size: 18,
              family: 'Roboto'
            },
            padding: 20
          },
          legend: {
            position: 'bottom',
            labels: {
              font: {
                family: 'Roboto'
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              font: {
                family: 'Roboto'
              }
            }
          },
          x: {
            ticks: {
              font: {
                family: 'Roboto'
              }
            }
          }
        }
      }
    });
    
    // Render biểu đồ
    chart.render();
    
    // Debug: Lưu biểu đồ vào file để kiểm tra
    const debugDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    
    const debugFilePath = path.join(debugDir, `watering-chart-${Date.now()}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(debugFilePath, buffer);
    
    console.log(`Watering chart saved for debugging at: ${debugFilePath}`);
    
    chart.destroy();
    
    return buffer;
  } catch (error) {
    console.error('Error generating watering chart:', error);
    throw error;
  }
};

/**
 * Tạo biểu đồ tròn cho phân bố sử dụng nước
 * @param {Array} pumpEvents - Dữ liệu các lần tưới nước
 * @returns {Buffer} - Buffer chứa hình ảnh biểu đồ
 */
exports.generateWaterDistributionChart = async (pumpEvents) => {
  try {
    // Nhóm dữ liệu theo khu vực
    const waterByZone = {};
    
    pumpEvents.forEach(event => {
      if (!waterByZone[event.zone]) {
        waterByZone[event.zone] = 0;
      }
      waterByZone[event.zone] += event.waterUsed;
    });
    
    // Chuẩn bị dữ liệu cho biểu đồ
    const zones = Object.keys(waterByZone);
    const waterData = zones.map(zone => waterByZone[zone]);
    
    // Tạo canvas
    const width = 500;
    const height = 500;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Màu sắc cho biểu đồ tròn
    const colors = [
      'rgba(255, 99, 132, 0.7)',
      'rgba(54, 162, 235, 0.7)',
      'rgba(255, 206, 86, 0.7)',
      'rgba(75, 192, 192, 0.7)',
      'rgba(153, 102, 255, 0.7)'
    ];
    
    // Tạo biểu đồ
    const chart = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: zones,
        datasets: [{
          data: waterData,
          backgroundColor: colors,
          borderWidth: 1
        }]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          title: {
            display: true,
            text: 'Phân Bố Sử Dụng Nước Theo Khu Vực',
            font: {
              size: 18,
              family: 'Roboto'
            },
            padding: 20
          },
          legend: {
            position: 'bottom',
            labels: {
              font: {
                family: 'Roboto'
              }
            }
          }
        }
      }
    });
    
    // Render biểu đồ
    chart.render();
    
    // Debug: Lưu biểu đồ vào file để kiểm tra
    const debugDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    
    const debugFilePath = path.join(debugDir, `distribution-chart-${Date.now()}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(debugFilePath, buffer);
    
    console.log(`Distribution chart saved for debugging at: ${debugFilePath}`);
    
    chart.destroy();
    
    return buffer;
  } catch (error) {
    console.error('Error generating water distribution chart:', error);
    throw error;
  }
};

/**
 * Format ngày dạng DD/MM
 * @param {String} dateString - Chuỗi ngày dạng YYYY-MM-DD
 * @returns {String} - Ngày định dạng DD/MM
 */
function formatDate(dateString) {
  const [year, month, day] = dateString.split('-');
  return `${day}/${month}`;
}