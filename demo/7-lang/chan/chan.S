TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/chan/chan.go
  chan.go:3		0x104e070		65488b0c2530000000	MOVQ GS:0x30, CX			
  chan.go:3		0x104e079		483b6110		CMPQ 0x10(CX), SP			
  chan.go:3		0x104e07d		0f8694000000		JBE 0x104e117				
  chan.go:3		0x104e083		4883ec38		SUBQ $0x38, SP				
  chan.go:3		0x104e087		48896c2430		MOVQ BP, 0x30(SP)			
  chan.go:3		0x104e08c		488d6c2430		LEAQ 0x30(SP), BP			
  chan.go:4		0x104e091		48c744242800000000	MOVQ $0x0, 0x28(SP)			
  chan.go:7		0x104e09a		48c744241000000000	MOVQ $0x0, 0x10(SP)			
  chan.go:5		0x104e0a3		c7042408000000		MOVL $0x8, 0(SP)			
  chan.go:5		0x104e0aa		488d056f0d0200		LEAQ go.func.*+68(SB), AX		
  chan.go:5		0x104e0b1		4889442408		MOVQ AX, 0x8(SP)			
  chan.go:5		0x104e0b6		e835cefdff		CALL runtime.newproc(SB)		
  chan.go:9		0x104e0bb		48837c242800		CMPQ $0x0, 0x28(SP)			
  chan.go:9		0x104e0c1		7502			JNE 0x104e0c5				
  chan.go:9		0x104e0c3		eb4b			JMP 0x104e110				
  chan.go:9		0x104e0c5		488b442428		MOVQ 0x28(SP), AX			
  chan.go:9		0x104e0ca		48890424		MOVQ AX, 0(SP)				
  chan.go:9		0x104e0ce		488d442420		LEAQ 0x20(SP), AX			
  chan.go:9		0x104e0d3		4889442408		MOVQ AX, 0x8(SP)			
  chan.go:9		0x104e0d8		e84369fbff		CALL runtime.chanrecv1(SB)		
  chan.go:9		0x104e0dd		488b442420		MOVQ 0x20(SP), AX			
  chan.go:9		0x104e0e2		4889442418		MOVQ AX, 0x18(SP)			
  chan.go:10		0x104e0e7		e88445fdff		CALL runtime.printlock(SB)		
  chan.go:10		0x104e0ec		488b442418		MOVQ 0x18(SP), AX			
  chan.go:10		0x104e0f1		48890424		MOVQ AX, 0(SP)				
  chan.go:10		0x104e0f5		e8e64cfdff		CALL runtime.printint(SB)		
  chan.go:10		0x104e0fa		e8f147fdff		CALL runtime.printnl(SB)		
  chan.go:10		0x104e0ff		e8ec45fdff		CALL runtime.printunlock(SB)		
  chan.go:9		0x104e104		eb00			JMP 0x104e106				
  chan.go:9		0x104e106		488b6c2430		MOVQ 0x30(SP), BP			
  chan.go:9		0x104e10b		4883c438		ADDQ $0x38, SP				
  chan.go:9		0x104e10f		c3			RET					
  chan.go:9		0x104e110		e8cb30feff		CALL runtime.block(SB)			
  chan.go:9		0x104e115		0f0b			UD2					
  chan.go:3		0x104e117		e8f488ffff		CALL runtime.morestack_noctxt(SB)	
  chan.go:3		0x104e11c		e94fffffff		JMP main.main(SB)			
  :-1			0x104e121		cc			INT $0x3				
  :-1			0x104e122		cc			INT $0x3				
  :-1			0x104e123		cc			INT $0x3				
  :-1			0x104e124		cc			INT $0x3				
  :-1			0x104e125		cc			INT $0x3				
  :-1			0x104e126		cc			INT $0x3				
  :-1			0x104e127		cc			INT $0x3				
  :-1			0x104e128		cc			INT $0x3				
  :-1			0x104e129		cc			INT $0x3				
  :-1			0x104e12a		cc			INT $0x3				
  :-1			0x104e12b		cc			INT $0x3				
  :-1			0x104e12c		cc			INT $0x3				
  :-1			0x104e12d		cc			INT $0x3				
  :-1			0x104e12e		cc			INT $0x3				
  :-1			0x104e12f		cc			INT $0x3				

TEXT main.main.func1(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/chan/chan.go
  chan.go:5		0x104e130		65488b0c2530000000	MOVQ GS:0x30, CX			
  chan.go:5		0x104e139		483b6110		CMPQ 0x10(CX), SP			
  chan.go:5		0x104e13d		7632			JBE 0x104e171				
  chan.go:5		0x104e13f		4883ec18		SUBQ $0x18, SP				
  chan.go:5		0x104e143		48896c2410		MOVQ BP, 0x10(SP)			
  chan.go:5		0x104e148		488d6c2410		LEAQ 0x10(SP), BP			
  chan.go:6		0x104e14d		488b442420		MOVQ 0x20(SP), AX			
  chan.go:6		0x104e152		48890424		MOVQ AX, 0(SP)				
  chan.go:6		0x104e156		488d055b850200		LEAQ main.statictmp_0(SB), AX		
  chan.go:6		0x104e15d		4889442408		MOVQ AX, 0x8(SP)			
  chan.go:6		0x104e162		e8b95dfbff		CALL runtime.chansend1(SB)		
  chan.go:7		0x104e167		488b6c2410		MOVQ 0x10(SP), BP			
  chan.go:7		0x104e16c		4883c418		ADDQ $0x18, SP				
  chan.go:7		0x104e170		c3			RET					
  chan.go:5		0x104e171		e89a88ffff		CALL runtime.morestack_noctxt(SB)	
  chan.go:5		0x104e176		ebb8			JMP main.main.func1(SB)			
  :-1			0x104e178		cc			INT $0x3				
  :-1			0x104e179		cc			INT $0x3				
  :-1			0x104e17a		cc			INT $0x3				
  :-1			0x104e17b		cc			INT $0x3				
  :-1			0x104e17c		cc			INT $0x3				
  :-1			0x104e17d		cc			INT $0x3				
  :-1			0x104e17e		cc			INT $0x3				
  :-1			0x104e17f		cc			INT $0x3				
