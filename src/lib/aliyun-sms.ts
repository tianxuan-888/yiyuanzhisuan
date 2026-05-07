/**
 * 阿里云短信认证服务模块
 * 使用号码认证服务的 SendSmsVerifyCode / CheckSmsVerifyCode HTTP API
 * 不依赖阿里云 SDK，直接用 fetch 调用，兼容 Cloudflare Workers Edge Runtime
 * 使用 V1 签名方式（HMAC-SHA1）
 */
import CryptoJS from 'crypto-js';

// 运行时读取环境变量
function getEnvConfig() {
  return {
    accessKeyId: process.env.ALIYUN_SMS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_SMS_ACCESS_KEY_SECRET || '',
    signName: process.env.ALIYUN_SMS_SIGN_NAME || '',
    templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE || '',
    templateCodeReset: process.env.ALIYUN_SMS_TEMPLATE_CODE_RESET || process.env.ALIYUN_SMS_TEMPLATE_CODE || '',
  };
}

// 按场景选择不同模板CODE
function getTemplateCode(scene: string): string {
  const config = getEnvConfig();
  const map: Record<string, string> = {
    register: config.templateCode,
    reset_password: config.templateCode,
    forgot_password: config.templateCode,
    default: config.templateCode,
  };
  return map[scene] || map['default'] || '';
}

/**
 * 生成 UUID（去除横线）
 */
function generateNonce(): string {
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

/**
 * ISO 8601 时间格式
 */
function formatISO8601(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * 百分号编码（阿里云 V1 规范）
 */
function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~')
    .replace(/'/g, '%27')
    .replace(/!/g, '%21')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/**
 * 调用阿里云 OpenAPI（V1 签名，RPC 风格）
 * 参考：https://help.aliyun.com/zh/sdk/developer-reference/v1-request-signature
 */
async function callAliyunAPI(
  action: string,
  params: Record<string, string>,
  accessKeyId: string,
  accessKeySecret: string,
): Promise<Record<string, unknown>> {
  const endpoint = 'https://dypnsapi.aliyuncs.com';

  // 公共参数
  const timestamp = formatISO8601(new Date());
  const nonce = generateNonce();

  const allParams: Record<string, string> = {
    Action: action,
    Format: 'JSON',
    Version: '2017-05-25',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: timestamp,
    SignatureVersion: '1.0',
    SignatureNonce: nonce,
    ...params,
  };

  // 1. 按参数名排序
  const sortedKeys = Object.keys(allParams).sort();

  // 2. 构造规范化请求字符串
  const canonicalizedQueryString = sortedKeys
    .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
    .join('&');

  // 3. 构造待签名字符串
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalizedQueryString)}`;

  // 4. 计算签名
  const key = accessKeySecret + '&';  // V1 签名的 key 末尾加 &
  const signature = CryptoJS.HmacSHA1(stringToSign, key).toString(CryptoJS.enc.Base64);

  // 5. 添加签名到参数
  allParams.Signature = signature;

  // 6. 构造 URL
  const queryString = Object.entries(allParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const url = `${endpoint}/?${queryString}`;

  // 7. 发送请求
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const result = await response.json();
  return result as Record<string, unknown>;
}

/**
 * 发送验证码短信
 */
export async function sendSmsVerifyCode(phone: string, scene: string = 'register'): Promise<{
  success: boolean;
  message: string;
  code?: string;
  requestId?: string;
}> {
  const config = getEnvConfig();
  const templateCode = getTemplateCode(scene);

  // 检查阿里云配置是否完整
  if (!config.accessKeyId || !config.accessKeySecret || !config.signName || !templateCode) {
    console.warn('[阿里云短信认证] 配置不完整，跳过真实发送');
    return {
      success: true,
      message: '验证码已发送（开发模式，未实际发送短信）',
      code: undefined,
    };
  }

  try {
    console.log(`[阿里云短信认证] 发送参数: phone=${phone}, signName=${config.signName}, templateCode=${templateCode}, scene=${scene}`);

    const templateParam = JSON.stringify({ code: '##code##', min: '5' });
    const result = await callAliyunAPI(
      'SendSmsVerifyCode',
      {
        PhoneNumber: phone,
        SignName: config.signName,
        TemplateCode: templateCode,
        TemplateParam: templateParam,
        CodeType: '1',
        CodeLength: '6',
        ReturnVerifyCode: 'true',
      },
      config.accessKeyId,
      config.accessKeySecret,
    );

    const resultCode = result.Code as string;
    const resultMessage = result.Message as string;

    if (resultCode === 'OK') {
      const model = result.Model as Record<string, unknown> | undefined;
      const verifyCode = model?.VerifyCode as string | undefined;
      const requestId = result.RequestId as string | undefined;
      console.log(`[阿里云短信认证] 发送成功: ${phone}, RequestId: ${requestId}, hasCode: ${!!verifyCode}`);
      return {
        success: true,
        message: '验证码已发送',
        code: verifyCode,
        requestId,
      };
    } else {
      console.error(`[阿里云短信认证] 发送失败: ${phone}, Code: ${resultCode}, Message: ${resultMessage}`);
      return {
        success: false,
        message: resultMessage || '短信发送失败',
      };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[阿里云短信认证] 发送异常:', errMsg);
    return {
      success: false,
      message: '短信发送失败，请稍后重试',
    };
  }
}

/**
 * 校验验证码
 */
export async function checkSmsVerifyCode(phone: string, verifyCode: string): Promise<{
  success: boolean;
  message: string;
}> {
  const config = getEnvConfig();
  if (!config.accessKeyId || !config.accessKeySecret || !config.signName) {
    return { success: true, message: '开发模式' };
  }

  try {
    const result = await callAliyunAPI(
      'CheckSmsVerifyCode',
      {
        PhoneNumber: phone,
        VerifyCode: verifyCode,
        CountryCode: '86',
      },
      config.accessKeyId,
      config.accessKeySecret,
    );

    const resultCode = result.Code as string;
    if (resultCode === 'OK') {
      const model = result.Model as Record<string, unknown> | undefined;
      const verifyResult = model?.VerifyResult as string | undefined;
      if (verifyResult === 'PASS') {
        return { success: true, message: '验证码校验通过' };
      } else {
        console.error(`[阿里云短信认证] 校验失败: ${phone}, VerifyResult: ${verifyResult}`);
        return { success: false, message: '验证码错误' };
      }
    } else {
      const resultMessage = result.Message as string;
      console.error(`[阿里云短信认证] 校验失败: ${phone}, Code: ${resultCode}, Message: ${resultMessage}`);
      return { success: false, message: resultMessage || '验证码错误' };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[阿里云短信认证] 校验异常:', errMsg);
    return { success: false, message: '验证码校验失败' };
  }
}

/**
 * 检查阿里云短信认证是否已配置
 */
export function isAliyunSmsConfigured(): boolean {
  const config = getEnvConfig();
  return !!(config.accessKeyId && config.accessKeySecret && config.signName);
}
