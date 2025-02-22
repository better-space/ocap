import { Employee, RequestContext, TenantOrganizationAwareCrudService } from '@metad/server-core'
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { FindOneOptions, Repository } from 'typeorm'
import { BusinessArea, BusinessAreaService } from '../business-area/index'
import { StoryPointPublicDTO } from './dto'
import { StoryPoint } from './story-point.entity'

@Injectable()
export class StoryPointService extends TenantOrganizationAwareCrudService<StoryPoint> {
	constructor(
		@InjectRepository(StoryPoint)
		pointRepository: Repository<StoryPoint>,
		@InjectRepository(Employee)
		protected readonly employeeRepository: Repository<Employee>,

		private businessAreaService: BusinessAreaService
	) {
		super(pointRepository, employeeRepository)
	}

	async findPublicOne(id: string, options: FindOneOptions) {
		const point = await this.repository.findOne(id, {
			relations: ['story', ...(options?.relations ?? [])],
			where: {
				story: {
					visibility: 'public'
				}
			}
		})

		if (!point) {
			throw new NotFoundException()
		}

		return new StoryPointPublicDTO(point)
	}

	protected async checkUpdateAuthorization(id: string | number) {
		const userId = RequestContext.currentUserId()
		const storyPoint = await this.findOne(id, { relations: ['story', 'story.businessArea'] })

		if (storyPoint?.story?.businessArea) {
			const businessAreaUser = await this.businessAreaService.getAccess(storyPoint.story.businessArea as BusinessArea)
			if (businessAreaUser?.role > 1) {
				throw new UnauthorizedException('Access reject')
			}
		} else if (storyPoint.createdById !== userId) {
			throw new UnauthorizedException('Not yours')
		}

	}
}
