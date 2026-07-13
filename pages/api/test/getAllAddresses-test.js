// pages/api/test/getAllAddresses-test.js
// Test file to check the structure and content of the getAllAddresses API (SQL Query 14)
import { blockIfProduction } from '../../../lib/api/blockInProduction';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export default async function handler(req, res) {
  if (blockIfProduction(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { SAP_SERVICE_LAYER_BASE_URL } = process.env;

  let b1session = req.cookies.B1SESSION;
  let routeid = req.cookies.ROUTEID;
  let sessionExpiry = req.cookies.B1SESSION_EXPIRY;

  if (!b1session || !routeid || !sessionExpiry || Date.now() >= new Date(sessionExpiry).getTime()) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }

  try {
    // Call SQL Query 14 directly to test
    const url = `${SAP_SERVICE_LAYER_BASE_URL}SQLQueries('sql14')/List`;

    console.log('Testing SQL Query 14:', url);

    const queryResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `B1SESSION=${b1session}; ROUTEID=${routeid}`
      }
    });

    if (!queryResponse.ok) {
      const errorText = await queryResponse.text();
      console.error('SAP API Error:', {
        status: queryResponse.status,
        statusText: queryResponse.statusText,
        body: errorText
      });
      return res.status(queryResponse.status).json({
        test: 'failed',
        error: 'SAP API call failed',
        status: queryResponse.status,
        details: errorText
      });
    }

    const responseText = await queryResponse.text();
    let queryData;
    
    try {
      queryData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse SAP response:', parseError);
      return res.status(500).json({
        test: 'error',
        error: 'Failed to parse SAP response as JSON',
        rawResponse: responseText.substring(0, 500) // First 500 chars for debugging
      });
    }

    const addresses = queryData.value || [];

    // Analyze the response structure
    const analysis = {
      test: 'success',
      summary: {
        totalAddresses: addresses.length,
        responseSize: responseText.length,
        queryId: 'sql14',
        fetchedAt: new Date().toISOString()
      },
      sampleRecord: addresses.length > 0 ? addresses[0] : null,
      fieldAnalysis: null,
      firstFewRecords: addresses.slice(0, 5),
      fieldStatistics: {}
    };

    // Analyze fields in the first record
    if (addresses.length > 0) {
      const firstRecord = addresses[0];
      const allFields = Object.keys(firstRecord);
      
      analysis.fieldAnalysis = {
        fields: allFields,
        fieldCount: allFields.length,
        sampleValues: {}
      };

      // Get sample values for each field
      allFields.forEach(key => {
        analysis.fieldAnalysis.sampleValues[key] = {
          value: firstRecord[key],
          type: typeof firstRecord[key],
          isNull: firstRecord[key] === null,
          isEmpty: firstRecord[key] === ''
        };
      });

      // Calculate statistics across all records for each field
      allFields.forEach(field => {
        const values = addresses
          .map(addr => addr[field])
          .filter(val => val !== null && val !== '');
        
        analysis.fieldStatistics[field] = {
          totalRecords: addresses.length,
          nonNullCount: values.length,
          nullCount: addresses.length - values.length,
          emptyStringCount: addresses.filter(addr => addr[field] === '').length,
          uniqueValues: [...new Set(values)].length,
          sampleValues: [...new Set(values)].slice(0, 5)
        };
      });
    }

    // Return detailed test results
    res.status(200).json({
      ...analysis,
      // Include full response but limit to first 10 records to avoid huge payload
      fullResponse: {
        value: addresses.slice(0, 10),
        totalCount: addresses.length,
        note: 'Showing first 10 records. Use /api/customers/getAllAddresses for full data.'
      }
    });

  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({
      test: 'error',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

