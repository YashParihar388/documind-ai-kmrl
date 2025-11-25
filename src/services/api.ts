// API configuration - Use localhost backend
const API_BASE_URL = 'http://localhost:3001/api';

// Debug: Log which API endpoint is being used
if (typeof window !== 'undefined') {
  console.log('API Configuration:', { API_BASE_URL });
}

// API client configuration
const apiClient = {
  async request(endpoint: string, options: RequestInit = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API Request Error (${endpoint}):`, error);
      throw error;
    }
  },

  get(endpoint: string, options?: RequestInit) {
    return this.request(endpoint, { method: 'GET', ...options });
  },

  post(endpoint: string, data?: any, options?: RequestInit) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
      ...options,
    });
  },

  put(endpoint: string, data?: any, options?: RequestInit) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
      ...options,
    });
  },

  patch(endpoint: string, data?: any, options?: RequestInit) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
      ...options,
    });
  },

  delete(endpoint: string, options?: RequestInit) {
    return this.request(endpoint, { method: 'DELETE', ...options });
  },

  // Upload files
  async upload(endpoint: string, formData: FormData, options?: RequestInit) {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const config: RequestInit = {
      method: 'POST',
      body: formData,
      ...options,
    };

    // Don't set Content-Type for FormData - let browser set it
    if (config.headers) {
      delete (config.headers as any)['Content-Type'];
    }

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Upload failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Upload Error (${endpoint}):`, error);
      throw error;
    }
  }
};

export default apiClient;
