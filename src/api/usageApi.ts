/**
 * API client para sa registration at pag-send ng usage data papunta sa backend.
 */

/** Isang app entry sa loob ng `payloads` array ng sync request. */
export interface UsageApiEntry {
  type: 'wifi' | 'data';
  packageName: string;
  downloadSize: string;
  uploadSize: string;
  uid: number;
  versionName: string; // "" kung hindi makuha (hal. na-uninstall na ang app)
  versionCode: number; // 0 kung hindi makuha
}

/** Buong body ng POST papuntang /app_usage/queue_create.php */
export interface UsageApiPayload {
  device_id: string;
  collected_at: string; // "YYYY-MM-DD HH:mm:ss"
  payloads: UsageApiEntry[];
}

/** Buong body ng POST papuntang /app_usage/users_create.php */
export interface RegistrationPayload {
  name: string;
  email: string;
  phone: string;
  device_id: string;
}

export interface SendResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

const API_BASE_URL = 'https://server2.capex.com.ph';
const SYNC_ENDPOINT = `${API_BASE_URL}/app_usage/queue_create.php`;
const REGISTER_ENDPOINT = `${API_BASE_URL}/app_usage/users_create.php`;

const REQUEST_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timed out after ${ms}ms`));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Shared na POST helper — JSON body, may timeout, at pare-parehong
 * hitsura ng SendResult para sa dalawang endpoint.
 */
async function postJson(url: string, body: unknown): Promise<SendResult> {
  try {
    const response = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      }),
      REQUEST_TIMEOUT_MS
    );

    const text = await response.text().catch(() => '');

    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        error: `HTTP ${response.status}: ${text || response.statusText}`,
      };
    }

    // Ang PHP endpoints ay pwedeng mag-200 pero may { success: false } sa body,
    // kaya tinitingnan din natin ang JSON kung parseable ito.
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.success === false) {
          return {
            success: false,
            statusCode: response.status,
            error: parsed.message || parsed.error || 'Tinanggihan ng server.',
          };
        }
      } catch {
        // Hindi JSON ang sagot — 2xx pa rin, ituring nating successful.
      }
    }

    return { success: true, statusCode: response.status };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Hindi kilalang network error.',
    };
  }
}

/**
 * I-send ang isang batch ng usage entries papunta sa backend queue.
 */
export async function sendUsagePayload(
  payload: UsageApiPayload
): Promise<SendResult> {
  return postJson(SYNC_ENDPOINT, payload);
}

/**
 * I-register ang user + device sa backend.
 */
export async function registerUser(
  payload: RegistrationPayload
): Promise<SendResult> {
  return postJson(REGISTER_ENDPOINT, payload);
}
