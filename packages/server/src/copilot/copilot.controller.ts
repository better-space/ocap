import { PermissionsEnum } from '@metad/contracts'
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { DeepPartial } from 'typeorm'
import { CrudController } from '../core'
import { PermissionGuard, Permissions } from './../shared';
import { Copilot } from './copilot.entity'
import { CopilotService } from './copilot.service'

@ApiTags('Copilot')
@ApiBearerAuth()
@Controller()
export class CopilotController extends CrudController<Copilot> {
	constructor(private readonly service: CopilotService, private readonly commandBus: CommandBus) {
		super(service)
	}

	@ApiOperation({ summary: 'Create new record' })
	@ApiResponse({
		status: HttpStatus.CREATED,
		description: 'The record has been successfully created.' /*, type: T*/
	})
	@ApiResponse({
		status: HttpStatus.BAD_REQUEST,
		description: 'Invalid input, The response body may contain clues as to what went wrong'
	})
	@UseGuards(PermissionGuard)
	@Permissions(PermissionsEnum.ORG_COPILOT_EDIT)
	@HttpCode(HttpStatus.CREATED)
	@Post()
	async create(@Body() entity: DeepPartial<Copilot>): Promise<Copilot> {
		if (entity.id) {
			await this.service.update(entity.id, entity)
			entity = await this.service.findOne(entity.id)
		} else {
			entity = await this.service.create(entity)
		}
		return entity as Copilot
	}
}
