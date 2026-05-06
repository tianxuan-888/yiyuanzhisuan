/**
 * 阿里云短信服务模块
 * 用于发送验证码短信
 */
import Dysmsapi, { SendSmsRequest } from '@alicloud/dysmsapi20170525';
import * as OpenApi from '@alicloud/openapi-client';
import { RuntimeOptions } from '@darabonba/typescript';

// 环境变量
const ACCESS_KEY_ID = process.env.ALIYUN_SMS_ACCESS_KEY_ID || '';
const ACCESS_KEY_SECRET = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET || '';
const SIGN_NAME = process.env.ALIYUN_SMS_SIGN_NAME || '';       // 短信签名
const TEMPLATE_CODE = process.env.ALIYUN_SMS_TEMPLATE_CODE || ''; // 短信模板CODE

let client: Dysmsapi | null = null;

/**
 * 获取阿里云短信客户端（单例）
 */
function getClient(): Dysmsapi {
  if (!client) {
    const config = new OpenApi.Config({
      accessKeyId: ACCESS_KEY_ID,
      accessKeySecret: ACCESS_KEY_SECRET,
      endpoint: 'dysmsapi.aliyuncs.com',
    });
    client = new Dysmsapi(config);
  }
  return client;
}

/**
 * 发送验证码短信
 * @param phone 手机号
 * @param code 验证码
 * @returns 发送结果
 */
export async function sendSmsVerifyCode(phone: string, code: string): Promise<{
  success: boolean;
  message: string;
  requestId?: string;
}> {
  // 检查阿里云配置是否完整
  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET || !SIGN_NAME || !TEMPLATE_CODE) {
    console.warn('[阿里云短信] 配置不完整，跳过真实发送。需要在环境变量中配置：');
    console.warn('  ALIYUN_SMS_ACCESS_KEY_ID');
    console.warn('  ALIYUN_SMS_ACCESS_KEY_SECRET');
    console.warn('  ALIYUN_SMS_SIGN_NAME');
    console.warn('  ALIYUN_SMS_TEMPLATE_CODE');
    return {
      success: true,
      message: '验证码已发送（开发模式，未实际发送短信）',
    };
  }

  try {
    const smsClient = getClient();
    const request = new SendSmsRequest({
      phoneNumbers: phone,
      signName: SIGN_NAME,
      templateCode: TEMPLATE_CODE,
      templateParam: JSON.stringify({ code }),
    });

    const runtime = new RuntimeOptions({});
    const response = await smsClient.sendSmsWithOptions(request, runtime);

    if (response.body?.code === 'OK') {
      console.log(`[阿里云短信] 发送成功: ${phone}, RequestId: ${response.body.requestId}`);
      return {
        success: true,
        message: '验证码已发送',
        requestId: response.body.requestId,
      };
    } else {
      console.error(`[阿里云短信] 发送失败: ${phone}, Code: ${response.body?.code}, Message: ${response.body?.message}`);
      return {
        success: false,
        message: response.body?.message || '短信发送失败',
      };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[阿里云短信] 发送异常:', errMsg);
    return {
      success: false,
      message: '短信发送失败，请稍后重试',
    };
  }
}

/**
 * 检查阿里云短信是否已配置
 */
export function isAliyunSmsConfigured(): boolean {
  return !!(ACCESS_KEY_ID && ACCESS_KEY_SECRET && SIGN_NAME && TEMPLATE_CODE);
}
