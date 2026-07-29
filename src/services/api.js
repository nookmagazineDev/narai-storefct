export const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbySsi-rYTkEBxtIXDV8CdTqg5vFKs1qQzTAL2We2ey25Xi-9TTTB3T7hg8rDE7-gbK8/exec";

export const apiCall = async (action, payload = {}) => {
  if (!SCRIPT_URL) {
    throw new Error("กรุณาตั้งค่า SCRIPT_URL ในไฟล์ src/services/api.js ก่อนใช้งาน");
  }

  try {
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action,
        ...payload
      }),
    });

    const result = await response.json();
    if (result.status === 'success') {
      return result;
    } else {
      throw new Error(result.message || "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์");
    }
  } catch (error) {
    console.error("API Error:", error);
    throw error;
  }
};
