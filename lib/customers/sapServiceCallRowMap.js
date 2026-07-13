function pickSapField(row, ...keys) {
  if (!row || typeof row !== 'object') return '';
  for (const key of keys) {
    const val = row[key];
    if (val != null && String(val).trim() !== '') return val;
  }
  return '';
}

export function mapSapServiceCallRow(item) {
  const rawId = pickSapField(item, 'ServiceCallID', "'ServiceCallID'", 'CallID');
  const parsedId = parseInt(String(rawId).replace(/'/g, ''), 10);
  return {
    serviceCallID: Number.isFinite(parsedId) ? parsedId : rawId,
    subject: pickSapField(item, 'Subject', "'Subject'"),
    customerName: pickSapField(item, 'CustomerName', "'CustomerName'"),
    createDate: pickSapField(item, 'CreateDate', "'CreateDate'"),
    createTime: pickSapField(item, 'CreateTime', "'CreateTime'"),
    description: pickSapField(item, 'Description', "'Description'"),
  };
}

export function mapODataServiceCallRow(item) {
  const rawId = item?.ServiceCallID ?? item?.CallID;
  const parsedId = parseInt(String(rawId ?? '').replace(/'/g, ''), 10);
  return {
    serviceCallID: Number.isFinite(parsedId) ? parsedId : rawId,
    subject: String(item?.Subject || '').trim(),
    customerName: String(item?.CustomerName || '').trim(),
    createDate: item?.CreateDate ?? '',
    createTime: item?.CreateTime ?? '',
    description: String(item?.Description || '').trim(),
  };
}

export function mergeServiceCallsFromCardCodes(perCodeResults) {
  const seen = new Set();
  const merged = [];
  for (const { cardCode, serviceCalls } of perCodeResults) {
    for (const row of serviceCalls || []) {
      const key = String(row.serviceCallID);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...row,
        fetchedForCardCode: cardCode,
      });
    }
  }
  return merged;
}
