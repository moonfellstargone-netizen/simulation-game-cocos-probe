import type { ActionRequest, ActionResult } from '../action/ActionTypes';
import type { DishLot, DomainEvent, MaterialLot, Order, ProcessingTask, Reservation, SaveFile } from '../domain/types';
import { RuntimeSchemaValidator } from './RuntimeSchemaValidator';

export class RuntimeContractValidator {
  constructor(private readonly schemas: RuntimeSchemaValidator) {}

  assertActionRequest(request: ActionRequest): ActionRequest {
    return this.schemas.assertValid('action_request.schema.json', request);
  }

  assertActionResult(result: ActionResult): ActionResult {
    return this.schemas.assertValid('action_result.schema.json', result);
  }

  assertDomainEvent(event: DomainEvent): DomainEvent {
    return this.schemas.assertValid('domain_event.schema.json', event);
  }

  assertSaveFile(save: SaveFile): SaveFile {
    return this.schemas.assertValid('save_file.schema.json', save);
  }

  assertProcessingTask(task: ProcessingTask): ProcessingTask {
    return this.schemas.assertValid('processing_task.schema.json', task);
  }

  assertMaterialLot(lot: MaterialLot): MaterialLot {
    return this.schemas.assertValid('material_lot.schema.json', lot);
  }

  assertDishLot(lot: DishLot): DishLot {
    return this.schemas.assertValid('dish_lot.schema.json', lot);
  }

  assertOrder(order: Order): Order {
    return this.schemas.assertValid('order.schema.json', order);
  }

  assertReservation(reservation: Reservation): Reservation {
    return this.schemas.assertValid('reservation.schema.json', reservation);
  }
}
