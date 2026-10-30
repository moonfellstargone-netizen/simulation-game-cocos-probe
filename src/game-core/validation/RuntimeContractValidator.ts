import type { ActionRequest, ActionResult } from '../action/ActionTypes';
import type { DishLot, DomainEvent, MaterialLot, Order, ProcessingTask, Reservation, SaveFile } from '../domain/types';
import { RuntimeSchemaValidator } from './RuntimeSchemaValidator';

const CONTRACT_SCHEMA_IDS = {
  actionRequest: 'action_request.schema.json',
  actionResult: 'action_result.schema.json',
  domainEvent: 'domain_event.schema.json',
  saveFile: 'save_file.schema.json',
  processingTask: 'processing_task.schema.json',
  materialLot: 'material_lot.schema.json',
  dishLot: 'dish_lot.schema.json',
  order: 'order.schema.json',
  reservation: 'reservation.schema.json'
} as const;

export class RuntimeContractValidator {
  constructor(private readonly schemas: RuntimeSchemaValidator) {}

  assertReady(): void {
    this.schemas.assertSchemasAvailable(Object.values(CONTRACT_SCHEMA_IDS));
  }

  assertActionRequest(request: ActionRequest): ActionRequest {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.actionRequest, request);
  }

  assertActionResult(result: ActionResult): ActionResult {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.actionResult, result);
  }

  assertDomainEvent(event: DomainEvent): DomainEvent {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.domainEvent, event);
  }

  assertSaveFile(save: SaveFile): SaveFile {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.saveFile, save);
  }

  assertProcessingTask(task: ProcessingTask): ProcessingTask {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.processingTask, task);
  }

  assertMaterialLot(lot: MaterialLot): MaterialLot {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.materialLot, lot);
  }

  assertDishLot(lot: DishLot): DishLot {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.dishLot, lot);
  }

  assertOrder(order: Order): Order {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.order, order);
  }

  assertReservation(reservation: Reservation): Reservation {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.reservation, reservation);
  }
}
