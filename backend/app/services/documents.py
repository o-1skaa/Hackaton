"""Demo JSON content validation, without PDF/OCR or actual customs integration."""
import json
from decimal import Decimal, InvalidOperation


def validate_documents(shipment, documents):
    results, parsed, reasons = [], {}, []
    counts = {kind: sum(doc.type.strip().lower()==kind for doc in documents) for kind in ('invoice','packing_list')}
    for kind, count in counts.items():
        if count != 1:
            reasons.append(f'{kind}: требуется ровно один документ')
    for doc in documents:
        kind, errors, data = doc.type.strip().lower(), [], None
        if counts.get(kind, 0) > 1:
            errors.append('Дублирующийся тип документа')
        if kind not in counts:
            errors.append('Неподдерживаемый тип документа')
        try:
            data = json.loads(doc.content or '')
            if not isinstance(data, dict):
                raise ValueError()
        except (ValueError, TypeError):
            errors.append('Загрузите JSON с полями shipment_id, weight_tonnes, document_number')
        if isinstance(data, dict):
            for field in ('shipment_id','weight_tonnes','document_number'):
                if field not in data or data[field] is None or str(data[field]).strip() == '':
                    errors.append(f'Отсутствует обязательное поле: {field}')
            if data.get('shipment_id') != shipment['id']:
                errors.append('Номер отправки не совпадает')
            if not isinstance(data.get('document_number'), str) or not data.get('document_number','').strip():
                errors.append('Номер документа должен быть непустой строкой')
            try:
                weight = Decimal(str(data.get('weight_tonnes')))
                if not weight.is_finite() or weight <= 0:
                    raise InvalidOperation()
                if weight != Decimal(str(shipment.get('weight_tonnes',20))):
                    errors.append('Масса не совпадает с отправкой')
            except InvalidOperation:
                errors.append('Масса должна быть положительным числом в тоннах')
            parsed[kind] = data
        results.append(dict(type=kind, filename=doc.filename, status='error' if errors else 'verified', reasons=errors))
    if all(kind in parsed for kind in counts):
        try:
            mismatch = Decimal(str(parsed['invoice'].get('weight_tonnes'))) != Decimal(str(parsed['packing_list'].get('weight_tonnes')))
        except InvalidOperation:
            mismatch = True
        if mismatch:
            for result in results:
                result['status'] = 'error'
                result['reasons'].append('Масса в invoice и packing list не совпадает')
    reasons += [f"{r['filename']}: {error}" for r in results for error in r['reasons']]
    return dict(status='rejected' if reasons else 'verified', reasons=reasons, documents=results)
