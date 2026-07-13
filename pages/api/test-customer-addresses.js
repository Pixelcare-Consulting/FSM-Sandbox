// pages/api/test-customer-addresses.js
// Test endpoint to verify customer address data

import { blockIfProduction } from '../../lib/api/blockInProduction';
import customerService from '../../lib/services/customerService.js';

export default async function handler(req, res) {
  if (blockIfProduction(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get session cookies
  const sessionCookies = (() => {
    const b1session = req.cookies.B1SESSION;
    const routeid = req.cookies.ROUTEID;
    const sessionExpiry = req.cookies.B1SESSION_EXPIRY;

    if (!b1session || !routeid) return null;
    if (sessionExpiry && Date.now() >= new Date(sessionExpiry).getTime()) return null;

    return { b1session, routeid };
  })();

  if (!sessionCookies) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get first few customers to test address data
    const result = await customerService.getCustomers({
      page: 1,
      limit: 5,
      orderBy: 'CardCode',
      orderDirection: 'asc',
      useCache: false // Don't use cache for testing
    }, sessionCookies);

    // Check what address data we're getting
    const addressAnalysis = result.customers.map(customer => ({
      CardCode: customer.CardCode,
      CardName: customer.CardName,
      hasBPAddresses: !!customer.BPAddresses,
      addressCount: customer.BPAddresses ? customer.BPAddresses.length : 0,
      billingAddresses: customer.BPAddresses ? 
        customer.BPAddresses.filter(addr => addr.AddressType === 'bo_BillTo').length : 0,
      shippingAddresses: customer.BPAddresses ? 
        customer.BPAddresses.filter(addr => addr.AddressType === 'bo_ShipTo').length : 0,
      sampleAddress: customer.BPAddresses && customer.BPAddresses.length > 0 ? {
        AddressName: customer.BPAddresses[0].AddressName,
        AddressType: customer.BPAddresses[0].AddressType,
        Street: customer.BPAddresses[0].Street,
        City: customer.BPAddresses[0].City,
        Country: customer.BPAddresses[0].Country,
        ZipCode: customer.BPAddresses[0].ZipCode
      } : null,
      // Also check basic address fields
      basicAddress: customer.Address,
      basicMailAddress: customer.MailAddress,
      basicCountry: customer.Country
    }));

    return res.status(200).json({
      success: true,
      message: 'Customer address analysis',
      totalCustomers: result.customers.length,
      addressAnalysis,
      summary: {
        customersWithBPAddresses: addressAnalysis.filter(c => c.hasBPAddresses).length,
        customersWithoutBPAddresses: addressAnalysis.filter(c => !c.hasBPAddresses).length,
        totalBillingAddresses: addressAnalysis.reduce((sum, c) => sum + c.billingAddresses, 0),
        totalShippingAddresses: addressAnalysis.reduce((sum, c) => sum + c.shippingAddresses, 0)
      }
    });

  } catch (error) {
    console.error('Error testing customer addresses:', error);
    return res.status(500).json({
      error: 'Failed to test customer addresses',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
