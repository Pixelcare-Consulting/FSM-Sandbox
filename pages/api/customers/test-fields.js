// pages/api/customers/test-fields.js
import { blockIfProduction } from '../../../lib/api/blockInProduction';
import sapService from '../../../lib/services/sapService.js';
import { 
  getFieldsByStrategy, 
  FIELD_SELECTION_STRATEGY,
  getStandardFields,
  getCustomFields,
  CUSTOM_BP_FIELDS
} from '../../../lib/config/sapFields.js';
import { 
  sendSuccess, 
  sendError, 
  sendUnauthorized, 
  sendMethodNotAllowed,
  asyncHandler
} from '../../../lib/utils/apiResponse.js';

/**
 * Test Fields API Endpoint
 * GET /api/customers/test-fields - Test which fields are available in your SAP system
 * 
 * Query Parameters:
 * - strategy: Field selection strategy (all, standard, minimal, summary)
 * - testCustomFields: Whether to test custom fields (true/false, default: false)
 */
const handler = asyncHandler(async (req, res) => {
  if (blockIfProduction(req, res)) return;

  if (req.method !== 'GET') {
    return sendMethodNotAllowed(res, ['GET']);
  }

  // Get and validate session cookies
  const sessionCookies = (() => {
    const b1session = req.cookies.B1SESSION;
    const routeid = req.cookies.ROUTEID;
    const sessionExpiry = req.cookies.B1SESSION_EXPIRY;

    if (!b1session || !routeid) return null;
    if (sessionExpiry && Date.now() >= new Date(sessionExpiry).getTime()) return null;
    
    return { b1session, routeid };
  })();

  if (!sessionCookies) {
    return sendUnauthorized(res, 'Session is missing or expired');
  }

  try {
    const strategy = req.query.strategy || 'standard';
    const testCustomFields = req.query.testCustomFields === 'true';

    // Get fields based on strategy
    const fields = getFieldsByStrategy(strategy);
    
    const result = {
      strategy,
      fields,
      fieldCount: fields.length,
      standardFields: getStandardFields(),
      customFields: getCustomFields(),
      customFieldConfig: CUSTOM_BP_FIELDS
    };

    // Test a simple query with standard fields only
    try {
      console.log('Testing standard fields query...');
      const testQuery = await sapService.getBusinessPartners({
        skip: 0,
        top: 1,
        filter: "CardType eq 'C'",
        select: 'CardCode,CardName,CardType'
      }, sessionCookies);
      
      result.standardFieldsTest = {
        success: true,
        message: 'Standard fields work correctly',
        sampleData: testQuery.value?.[0] || null
      };
    } catch (error) {
      result.standardFieldsTest = {
        success: false,
        error: error.message
      };
    }

    // Test custom fields if requested
    if (testCustomFields) {
      result.customFieldTests = {};
      
      const customFieldsToTest = Object.entries(CUSTOM_BP_FIELDS)
        .filter(([key, value]) => value !== null);

      for (const [key, fieldName] of customFieldsToTest) {
        try {
          console.log(`Testing custom field: ${fieldName}`);
          await sapService.getBusinessPartners({
            skip: 0,
            top: 1,
            filter: "CardType eq 'C'",
            select: `CardCode,${fieldName}`
          }, sessionCookies);
          
          result.customFieldTests[key] = {
            fieldName,
            success: true,
            message: 'Field exists and is accessible'
          };
        } catch (error) {
          result.customFieldTests[key] = {
            fieldName,
            success: false,
            error: error.message,
            recommendation: error.message.includes('invalid') || error.message.includes('Property') 
              ? 'Field does not exist - set to null in sapFields.js config'
              : 'Other error - check SAP connection'
          };
        }
      }
    }

    return sendSuccess(res, result, 'Field test completed');

  } catch (error) {
    console.error('Error in test-fields API:', {
      message: error.message,
      stack: error.stack,
      query: req.query,
      timestamp: new Date().toISOString()
    });

    return sendError(res, 'Failed to test fields', 500);
  }
});

export default handler;
