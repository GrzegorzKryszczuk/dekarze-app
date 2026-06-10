// netlify/functions/shoper-orders.js
// Proxy dla Shoper REST API — omija CORS i ukrywa token przed frontendem

const SHOPER_URL   = process.env.SHOPER_URL;   // https://dekarze.pl
const SHOPER_TOKEN = process.env.SHOPER_TOKEN; // Token API z panelu Shopera

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!SHOPER_URL || !SHOPER_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Brak konfiguracji SHOPER_URL lub SHOPER_TOKEN' }),
    };
  }

  try {
    // Parametry z query string: ?status=new&limit=50&page=1
    const params   = event.queryStringParameters || {};
    const limit    = params.limit  || 50;
    const page     = params.page   || 1;
    const statusId = params.status_id || ''; // Shoper używa numerycznych ID statusów

    // Buduj URL do Shoper API
    let apiUrl = `${SHOPER_URL}/webapi/rest/orders?limit=${limit}&page=${page}&order=id%20desc`;
    if (statusId) apiUrl += `&filters={"status_id":${statusId}}`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SHOPER_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: `Shoper API error ${response.status}`,
          details: errorText,
        }),
      };
    }

    const data = await response.json();

    // Normalizuj dane do formatu używanego przez aplikację
    const orders = (data.list || []).map(o => ({
      id:     `#${o.order_id}`,
      client: `${o.delivery_firstname || ''} ${o.delivery_lastname || ''}`.trim() || o.email,
      email:  o.email || '',
      date:   formatDate(o.add_date),
      amount: formatAmount(o.order_total, o.currency),
      status: mapStatus(o.status_id),
      status_id: o.status_id,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        orders,
        total: data.count || orders.length,
        pages: data.pages || 1,
        page:  data.page  || 1,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// Formatuje datę Shopera (timestamp lub string) do "RRRR-MM-DD HH:MM"
function formatDate(raw) {
  if (!raw) return '—';
  const d = new Date(typeof raw === 'number' ? raw * 1000 : raw);
  if (isNaN(d)) return raw;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Formatuje kwotę
function formatAmount(total, currency) {
  if (!total) return '—';
  const num = parseFloat(total).toFixed(2).replace('.', ',');
  return `${num} ${currency || 'PLN'}`;
}

// Mapuje numeryczne status_id Shopera na klucze używane w aplikacji
// Dostosuj wg ustawień swojego sklepu (Ustawienia → Zamówienia → Statusy)
function mapStatus(statusId) {
  const map = {
    1:  'new',         // Nowe
    2:  'paid',        // Opłacone
    3:  'processing',  // W realizacji
    4:  'shipped',     // Wysłane
    5:  'completed',   // Zakończone
    6:  'cancelled',   // Anulowane
  };
  return map[statusId] || 'new';
}
