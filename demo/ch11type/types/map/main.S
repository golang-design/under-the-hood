TEXT main.write(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/map/main.go
  main.go:8		0x1093820		65488b0c2530000000		MOVQ GS:0x30, CX			
  main.go:8		0x1093829		488d8424b0feffff		LEAQ 0xfffffeb0(SP), AX			
  main.go:8		0x1093831		483b4110			CMPQ 0x10(CX), AX			
  main.go:8		0x1093835		0f8637030000			JBE 0x1093b72				
  main.go:8		0x109383b		4881ecd0010000			SUBQ $0x1d0, SP				
  main.go:8		0x1093842		4889ac24c8010000		MOVQ BP, 0x1c8(SP)			
  main.go:8		0x109384a		488dac24c8010000		LEAQ 0x1c8(SP), BP			
  main.go:9		0x1093852		48c744244040420f00		MOVQ $0xf4240, 0x40(SP)			
  main.go:10		0x109385b		48c784244801000000000000	MOVQ $0x0, 0x148(SP)			
  main.go:10		0x1093867		0f57c9				XORPS X1, X1				
  main.go:10		0x109386a		0f118c2450010000		MOVUPS X1, 0x150(SP)			
  main.go:11		0x1093872		0f57c9				XORPS X1, X1				
  main.go:11		0x1093875		0f118c2498010000		MOVUPS X1, 0x198(SP)			
  main.go:11		0x109387d		0f57c9				XORPS X1, X1				
  main.go:11		0x1093880		0f118c24a8010000		MOVUPS X1, 0x1a8(SP)			
  main.go:11		0x1093888		0f57c9				XORPS X1, X1				
  main.go:11		0x109388b		0f118c24b8010000		MOVUPS X1, 0x1b8(SP)			
  main.go:11		0x1093893		488d7c2478			LEAQ 0x78(SP), DI			
  main.go:11		0x1093898		0f57c0				XORPS X0, X0				
  main.go:11		0x109389b		488d7fd0			LEAQ -0x30(DI), DI			
  main.go:11		0x109389f		48896c24f0			MOVQ BP, -0x10(SP)			
  main.go:11		0x10938a4		488d6c24f0			LEAQ -0x10(SP), BP			
  main.go:11		0x10938a9		e824dffbff			CALL 0x10517d2				
  main.go:11		0x10938ae		488b6d00			MOVQ 0(BP), BP				
  main.go:11		0x10938b2		488d842498010000		LEAQ 0x198(SP), AX			
  main.go:11		0x10938ba		8400				TESTB AL, 0(AX)				
  main.go:11		0x10938bc		488d442478			LEAQ 0x78(SP), AX			
  main.go:11		0x10938c1		48898424a8010000		MOVQ AX, 0x1a8(SP)			
  main.go:11		0x10938c9		488d842498010000		LEAQ 0x198(SP), AX			
  main.go:11		0x10938d1		4889842420010000		MOVQ AX, 0x120(SP)			
  main.go:11		0x10938d9		e8e2c3faff			CALL runtime.fastrand(SB)		
  main.go:11		0x10938de		488b842420010000		MOVQ 0x120(SP), AX			
  main.go:11		0x10938e6		8400				TESTB AL, 0(AX)				
  main.go:11		0x10938e8		8b0c24				MOVL 0(SP), CX				
  main.go:11		0x10938eb		89480c				MOVL CX, 0xc(AX)			
  main.go:11		0x10938ee		488d842498010000		LEAQ 0x198(SP), AX			
  main.go:11		0x10938f6		4889842408010000		MOVQ AX, 0x108(SP)			
  main.go:12		0x10938fe		48c744245000000000		MOVQ $0x0, 0x50(SP)			
  main.go:12		0x1093907		eb00				JMP 0x1093909				
  main.go:13		0x1093909		eb00				JMP 0x109390b				
  main.go:13		0x109390b		e8c040fdff			CALL time.Now(SB)			
  main.go:13		0x1093910		488b0424			MOVQ 0(SP), AX				
  main.go:13		0x1093914		488b4c2408			MOVQ 0x8(SP), CX			
  main.go:13		0x1093919		488b542410			MOVQ 0x10(SP), DX			
  main.go:13		0x109391e		4889842448010000		MOVQ AX, 0x148(SP)			
  main.go:13		0x1093926		48898c2450010000		MOVQ CX, 0x150(SP)			
  main.go:13		0x109392e		4889942458010000		MOVQ DX, 0x158(SP)			
  main.go:14		0x1093936		48c744244800000000		MOVQ $0x0, 0x48(SP)			
  main.go:14		0x109393f		eb00				JMP 0x1093941				
  main.go:14		0x1093941		488b442440			MOVQ 0x40(SP), AX			
  main.go:14		0x1093946		4839442448			CMPQ AX, 0x48(SP)			
  main.go:14		0x109394b		7c02				JL 0x109394f				
  main.go:14		0x109394d		eb63				JMP 0x10939b2				
  main.go:15		0x109394f		488b442450			MOVQ 0x50(SP), AX			
  main.go:15		0x1093954		4803442448			ADDQ 0x48(SP), AX			
  main.go:15		0x1093959		4889442470			MOVQ AX, 0x70(SP)			
  main.go:15		0x109395e		488d05fb6d0100			LEAQ runtime.rodata+92544(SB), AX	
  main.go:15		0x1093965		48890424			MOVQ AX, 0(SP)				
  main.go:15		0x1093969		488b8c2408010000		MOVQ 0x108(SP), CX			
  main.go:15		0x1093971		48894c2408			MOVQ CX, 0x8(SP)			
  main.go:15		0x1093976		488b4c2450			MOVQ 0x50(SP), CX			
  main.go:15		0x109397b		48034c2448			ADDQ 0x48(SP), CX			
  main.go:15		0x1093980		48894c2410			MOVQ CX, 0x10(SP)			
  main.go:15		0x1093985		e846b0f7ff			CALL runtime.mapassign_fast64(SB)	
  main.go:15		0x109398a		488b442418			MOVQ 0x18(SP), AX			
  main.go:15		0x109398f		4889842418010000		MOVQ AX, 0x118(SP)			
  main.go:15		0x1093997		8400				TESTB AL, 0(AX)				
  main.go:15		0x1093999		488b4c2470			MOVQ 0x70(SP), CX			
  main.go:15		0x109399e		488908				MOVQ CX, 0(AX)				
  main.go:15		0x10939a1		eb00				JMP 0x10939a3				
  main.go:14		0x10939a3		488b442448			MOVQ 0x48(SP), AX			
  main.go:14		0x10939a8		48ffc0				INCQ AX					
  main.go:14		0x10939ab		4889442448			MOVQ AX, 0x48(SP)			
  main.go:14		0x10939b0		eb8f				JMP 0x1093941				
  main.go:17		0x10939b2		488b442450			MOVQ 0x50(SP), AX			
  main.go:17		0x10939b7		4889442468			MOVQ AX, 0x68(SP)			
  main.go:17		0x10939bc		488b842448010000		MOVQ 0x148(SP), AX			
  main.go:17		0x10939c4		488b8c2450010000		MOVQ 0x150(SP), CX			
  main.go:17		0x10939cc		488b942458010000		MOVQ 0x158(SP), DX			
  main.go:17		0x10939d4		48890424			MOVQ AX, 0(SP)				
  main.go:17		0x10939d8		48894c2408			MOVQ CX, 0x8(SP)			
  main.go:17		0x10939dd		4889542410			MOVQ DX, 0x10(SP)			
  main.go:17		0x10939e2		e8193dfdff			CALL time.Since(SB)			
  main.go:17		0x10939e7		488b442418			MOVQ 0x18(SP), AX			
  main.go:17		0x10939ec		4889442460			MOVQ AX, 0x60(SP)			
  main.go:17		0x10939f1		48890424			MOVQ AX, 0(SP)				
  main.go:17		0x10939f5		e80639fdff			CALL time.Duration.Seconds(SB)		
  main.go:17		0x10939fa		f20f10442408			MOVSD_XMM 0x8(SP), X0			
  main.go:17		0x1093a00		f20f11442458			MOVSD_XMM X0, 0x58(SP)			
  main.go:17		0x1093a06		0f57c0				XORPS X0, X0				
  main.go:17		0x1093a09		0f11842478010000		MOVUPS X0, 0x178(SP)			
  main.go:17		0x1093a11		0f57c0				XORPS X0, X0				
  main.go:17		0x1093a14		0f11842488010000		MOVUPS X0, 0x188(SP)			
  main.go:17		0x1093a1c		488d842478010000		LEAQ 0x178(SP), AX			
  main.go:17		0x1093a24		4889842410010000		MOVQ AX, 0x110(SP)			
  main.go:17		0x1093a2c		488d054dfe0000			LEAQ runtime.rodata+64160(SB), AX	
  main.go:17		0x1093a33		48890424			MOVQ AX, 0(SP)				
  main.go:17		0x1093a37		488b4c2468			MOVQ 0x68(SP), CX			
  main.go:17		0x1093a3c		48894c2408			MOVQ CX, 0x8(SP)			
  main.go:17		0x1093a41		e80a4bf7ff			CALL runtime.convT2E64(SB)		
  main.go:17		0x1093a46		488b442410			MOVQ 0x10(SP), AX			
  main.go:17		0x1093a4b		488b4c2418			MOVQ 0x18(SP), CX			
  main.go:17		0x1093a50		4889842438010000		MOVQ AX, 0x138(SP)			
  main.go:17		0x1093a58		48898c2440010000		MOVQ CX, 0x140(SP)			
  main.go:17		0x1093a60		488b942410010000		MOVQ 0x110(SP), DX			
  main.go:17		0x1093a68		8402				TESTB AL, 0(DX)				
  main.go:17		0x1093a6a		488902				MOVQ AX, 0(DX)				
  main.go:17		0x1093a6d		488d7a08			LEAQ 0x8(DX), DI			
  main.go:17		0x1093a71		833d78150f0000			CMPL $0x0, runtime.writeBarrier(SB)	
  main.go:17		0x1093a78		7405				JE 0x1093a7f				
  main.go:17		0x1093a7a		e9e6000000			JMP 0x1093b65				
  main.go:17		0x1093a7f		48894a08			MOVQ CX, 0x8(DX)			
  main.go:17		0x1093a83		eb00				JMP 0x1093a85				
  main.go:17		0x1093a85		488d0574f80000			LEAQ runtime.rodata+62752(SB), AX	
  main.go:17		0x1093a8c		48890424			MOVQ AX, 0(SP)				
  main.go:17		0x1093a90		f20f10442458			MOVSD_XMM 0x58(SP), X0			
  main.go:17		0x1093a96		f20f11442408			MOVSD_XMM X0, 0x8(SP)			
  main.go:17		0x1093a9c		e8af4af7ff			CALL runtime.convT2E64(SB)		
  main.go:17		0x1093aa1		488b442418			MOVQ 0x18(SP), AX			
  main.go:17		0x1093aa6		488b4c2410			MOVQ 0x10(SP), CX			
  main.go:17		0x1093aab		48898c2428010000		MOVQ CX, 0x128(SP)			
  main.go:17		0x1093ab3		4889842430010000		MOVQ AX, 0x130(SP)			
  main.go:17		0x1093abb		488b942410010000		MOVQ 0x110(SP), DX			
  main.go:17		0x1093ac3		8402				TESTB AL, 0(DX)				
  main.go:17		0x1093ac5		48894a10			MOVQ CX, 0x10(DX)			
  main.go:17		0x1093ac9		488d7a18			LEAQ 0x18(DX), DI			
  main.go:17		0x1093acd		833d1c150f0000			CMPL $0x0, runtime.writeBarrier(SB)	
  main.go:17		0x1093ad4		7405				JE 0x1093adb				
  main.go:17		0x1093ad6		e980000000			JMP 0x1093b5b				
  main.go:17		0x1093adb		48894218			MOVQ AX, 0x18(DX)			
  main.go:17		0x1093adf		eb00				JMP 0x1093ae1				
  main.go:17		0x1093ae1		488b842410010000		MOVQ 0x110(SP), AX			
  main.go:17		0x1093ae9		8400				TESTB AL, 0(AX)				
  main.go:17		0x1093aeb		eb00				JMP 0x1093aed				
  main.go:17		0x1093aed		4889842460010000		MOVQ AX, 0x160(SP)			
  main.go:17		0x1093af5		48c784246801000002000000	MOVQ $0x2, 0x168(SP)			
  main.go:17		0x1093b01		48c784247001000002000000	MOVQ $0x2, 0x170(SP)			
  main.go:17		0x1093b0d		488d054d310300			LEAQ go.string.*+7233(SB), AX		
  main.go:17		0x1093b14		48890424			MOVQ AX, 0(SP)				
  main.go:17		0x1093b18		48c744240812000000		MOVQ $0x12, 0x8(SP)			
  main.go:17		0x1093b21		488b8c2460010000		MOVQ 0x160(SP), CX			
  main.go:17		0x1093b29		48894c2410			MOVQ CX, 0x10(SP)			
  main.go:17		0x1093b2e		48c744241802000000		MOVQ $0x2, 0x18(SP)			
  main.go:17		0x1093b37		48c744242002000000		MOVQ $0x2, 0x20(SP)			
  main.go:17		0x1093b40		e8fb7bffff			CALL fmt.Printf(SB)			
  main.go:17		0x1093b45		eb00				JMP 0x1093b47				
  main.go:12		0x1093b47		488b442450			MOVQ 0x50(SP), AX			
  main.go:12		0x1093b4c		4803442440			ADDQ 0x40(SP), AX			
  main.go:12		0x1093b51		4889442450			MOVQ AX, 0x50(SP)			
  main.go:12		0x1093b56		e9aefdffff			JMP 0x1093909				
  main.go:17		0x1093b5b		e800d2fbff			CALL runtime.gcWriteBarrier(SB)		
  main.go:17		0x1093b60		e97cffffff			JMP 0x1093ae1				
  main.go:17		0x1093b65		4889c8				MOVQ CX, AX				
  main.go:17		0x1093b68		e8f3d1fbff			CALL runtime.gcWriteBarrier(SB)		
  main.go:17		0x1093b6d		e913ffffff			JMP 0x1093a85				
  main.go:8		0x1093b72		e8f9b3fbff			CALL runtime.morestack_noctxt(SB)	
  main.go:8		0x1093b77		e9a4fcffff			JMP main.write(SB)			
  :-1			0x1093b7c		cc				INT $0x3				
  :-1			0x1093b7d		cc				INT $0x3				
  :-1			0x1093b7e		cc				INT $0x3				
  :-1			0x1093b7f		cc				INT $0x3				
